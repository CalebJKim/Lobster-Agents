"""State endpoints + root liveness + file upload + demo cleanup.

The router is mounted at the application root with no prefix.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime

from fastapi import APIRouter, HTTPException, UploadFile

from nemoclaw_reef.claw_config import CLAW_IDENTITIES, SANDBOX_WORKSPACES, SandboxWorkspace
from nemoclaw_reef.config import settings
from nemoclaw_reef.infra.app_state import app_state
from nemoclaw_reef.models import AgentState
from nemoclaw_reef.state.layout import ROOM_POSITIONS, ROOMS, get_room_position, release_room_seat
from nemoclaw_reef.integrations.nemoclaw_cli import (
    clear_pending_network_rules,
    clear_sandbox_state,
    get_nemoclaw_status,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/")
async def root_liveness() -> dict[str, object]:
    """Cheap liveness probe — proves the FastAPI process is up."""

    orch = app_state.orchestrator
    return {
        "status": "ok",
        "service": "nemoclaw-reef",
        "simulation_running": orch.running if orch else False,
    }


@router.get("/state")
async def get_state() -> dict[str, object]:
    """Full reef snapshot — agents, current_query, bulletin, whiteboard."""

    return app_state.require_reef_state().to_dict()


@router.get("/bulletin")
async def get_bulletin() -> dict[str, object]:
    return {"posts": app_state.require_reef_state().bulletin_posts}


@router.get("/whiteboard")
async def get_whiteboard() -> dict[str, object]:
    return {"entries": app_state.require_reef_state().whiteboard}


@router.get("/layout")
async def get_layout() -> dict[str, object]:
    return {
        "rooms": ROOMS,
        "room_positions": {
            name: {"x": pos[0], "y": pos[1]}
            for name, pos in ROOM_POSITIONS.items()
        },
    }


@router.get("/history")
async def get_history() -> dict[str, object]:
    reef = app_state.reef_state
    store = reef.get_store() if reef else None
    if not store:
        return {"deliverables": []}
    return {"deliverables": await store.get_deliverables(limit=20)}


@router.get("/agents")
async def get_agents() -> dict[str, object]:
    return {"agents": [a.to_info() for a in app_state.require_orchestrator().agents]}


@router.post("/demo/cleanup")
async def cleanup_demo(req: dict | None = None) -> dict[str, object]:
    """Return the booth to a clean starter state without destroying sandboxes.

    Default behavior is tuned for between-demo cleanup:
    - cancel active runs
    - clear assignments/run UI state
    - delete visitor-created agents from the live roster
    - archive and wipe configured sandbox work/run directories
    - clear pending OpenShell network-rule recommendations
    - remove dynamic sandbox registrations so the map returns to four huts

    Live NemoClaw/OpenShell sandboxes remain on the host. They are hidden unless
    re-registered through the UI or the operator opts into live-only display.
    """

    body = req or {}
    mode = str(body.get("mode") or "booth")
    if mode not in {"booth", "factory"}:
        raise HTTPException(status_code=400, detail="mode must be booth or factory")

    clear_sandbox_files = bool(body.get("clear_sandbox_files", True))
    delete_visitor_agents = bool(body.get("delete_visitor_agents", True))
    reset_to_default_sandboxes = bool(body.get("reset_to_default_sandboxes", True))
    clear_pending_rules = bool(body.get("clear_pending_rules", True))

    orch = app_state.require_orchestrator()
    reef = app_state.require_reef_state()
    store = reef.get_store()
    broadcaster = app_state.broadcaster

    results: dict[str, object] = {
        "mode": mode,
        "cancelled_runs": True,
        "deleted_agents": [],
        "sandbox_clears": [],
        "pending_rule_clears": [],
        "removed_dynamic_sandboxes": 0,
        "cleared_display_names": 0,
        "cleared_saved_agents": 0,
    }

    await orch.cancel_all_sandbox_runs(reason=f"{mode}_cleanup")
    orch.clear_sandbox_run_statuses()
    await _reset_reef_state(orch, reef)

    workspaces_to_clear = await _cleanup_workspace_targets(store)
    live_names = await _live_sandbox_names()
    if clear_sandbox_files:
        clear_tasks = [
            clear_sandbox_state(workspace.name, timeout_seconds=60)
            for workspace in workspaces_to_clear
            if workspace.name in live_names
        ]
        if clear_tasks:
            clear_results = await asyncio.gather(*clear_tasks, return_exceptions=True)
            results["sandbox_clears"] = [
                _result_or_error(result) for result in clear_results
            ]

    if clear_pending_rules:
        rule_tasks = [
            clear_pending_network_rules(workspace.name)
            for workspace in workspaces_to_clear
            if workspace.name in live_names
        ]
        if rule_tasks:
            rule_results = await asyncio.gather(*rule_tasks, return_exceptions=True)
            results["pending_rule_clears"] = [
                _result_or_error(result) for result in rule_results
            ]

    if delete_visitor_agents:
        starter_names = set(CLAW_IDENTITIES)
        for agent in list(orch.agents):
            if agent.name in starter_names:
                continue
            try:
                removed = await orch.remove_lobster(agent.name)
            except RuntimeError as exc:
                results.setdefault("agent_delete_errors", []).append({
                    "name": agent.name,
                    "error": str(exc),
                })
                continue
            if removed:
                results["deleted_agents"].append(agent.name)
        if store:
            results["cleared_saved_agents"] = await store.clear_visitor_agents()

    if reset_to_default_sandboxes and store:
        results["removed_dynamic_sandboxes"] = await store.clear_user_sandbox_workspaces()
        results["cleared_display_names"] = await store.clear_display_overrides()
        orch.sandboxes.sync_sandbox_workspaces(list(SANDBOX_WORKSPACES))

    if broadcaster:
        await broadcaster.broadcast({
            "type": "demo_cleanup_finished",
            "mode": mode,
            "results": results,
            "timestamp": datetime.now().isoformat(),
        })
        await broadcaster.broadcast({
            "type": "full_state",
            "agents": [a.to_info() for a in orch.agents],
            "office": reef.to_dict(),
            "sandbox_assignments": orch.get_sandbox_assignments(),
            "timestamp": datetime.now().isoformat(),
        })

    return {"status": "ok", **results}


async def _cleanup_workspace_targets(store) -> list[SandboxWorkspace]:
    workspaces = list(SANDBOX_WORKSPACES)
    if not store:
        return workspaces
    try:
        rows = await store.list_sandbox_workspaces()
    except Exception:
        logger.exception("Could not load dynamic workspaces for cleanup")
        return workspaces
    seen = {workspace.name for workspace in workspaces}
    for row in rows:
        name = str(row.get("sandbox_name") or "").strip()
        display_name = str(row.get("display_name") or name).strip() or name
        home_room = str(row.get("home_room") or f"sandbox_cleanup_{len(workspaces)}").strip()
        if not name or name in seen:
            continue
        workspaces.append(SandboxWorkspace(name, home_room, display_name, source=str(row.get("source") or "user")))
        seen.add(name)
    return workspaces


async def _live_sandbox_names() -> set[str]:
    try:
        status = await get_nemoclaw_status()
    except Exception:
        logger.exception("Could not load live sandbox names for cleanup")
        return set()
    names: set[str] = set()
    for sandbox in status.get("sandboxes", []):
        if isinstance(sandbox, dict) and isinstance(sandbox.get("name"), str):
            names.add(sandbox["name"])
    return names


def _result_or_error(result: object) -> object:
    if isinstance(result, Exception):
        return {"ok": False, "error": f"{type(result).__name__}: {result}"}
    return result


async def _reset_reef_state(orch, reef) -> None:
    """Soft-reset query/chat/task assignment state without deleting profiles."""

    try:
        orch._idle_chat.reset()
    except Exception:
        logger.exception("Could not reset idle chat during demo cleanup")
    reef.current_query = None
    reef.current_files = []
    reef.whiteboard.clear()
    orch._query_tick = 0
    orch.sandbox_assignments.clear()
    for agent in orch.agents:
        agent.current_task = None
        agent.event_queue.clear()
        agent.state = AgentState.idle
        release_room_seat(agent.location, agent.name)
        agent.sandbox_name = None
        agent.sandbox_home_room = None
        agent.connect_command = None
        agent.location = "war_room"
        agent.position = get_room_position("war_room", agent.name)
        state = reef.agent_states.setdefault(agent.name, {})
        state["state"] = "idle"
        state["location"] = agent.location
        state["position"] = {"x": agent.position[0], "y": agent.position[1]}
        state["current_task"] = None
        state["sandbox_name"] = None
        state["sandbox_home_room"] = None
        state["connect_command"] = None


@router.post("/upload")
async def upload_file(file: UploadFile) -> dict[str, object]:
    """Save an uploaded file and expose it to agents via the file_reader tool."""

    upload_dir = "/data/uploads"
    os.makedirs(upload_dir, exist_ok=True)

    safe_name = os.path.basename(file.filename or "uploaded_file")
    dest = os.path.join(upload_dir, safe_name)
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)

    if upload_dir not in settings.allowed_file_paths:
        settings.allowed_file_paths.append(upload_dir)

    logger.info("File uploaded: %s (%d bytes)", dest, len(content))
    return {"path": dest, "name": safe_name, "size": len(content)}
