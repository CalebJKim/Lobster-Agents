"""NemoClaw sandbox endpoints — listing, team assignment, task runs, policies."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from office_agents.claw_config import SANDBOX_WORKSPACES
from office_agents.infra.app_state import app_state
from office_agents.models import SandboxPolicyRequest, SandboxTaskRequest, SandboxTeamRequest
from office_agents.sandbox_runtime.nemoclaw import (
    clear_sandbox_state,
    get_nemoclaw_status,
    get_openclaw_approvals,
    get_policy_presets,
    set_policy_preset,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/sandboxes")
async def get_sandboxes() -> dict[str, object]:
    """Merge configured workspaces with live nemoclaw status + run/team state."""

    status = await get_nemoclaw_status()

    orch = app_state.orchestrator
    office = app_state.office_state
    assignments = orch.get_sandbox_assignments() if orch else {}
    run_statuses = orch.get_sandbox_run_statuses() if orch else {}
    agents_by_name = {a.name: a.to_info() for a in orch.agents} if orch else {}

    # User-defined display names override the claw_config defaults.
    overrides: dict[str, str] = {}
    if office and office._store:
        try:
            overrides = await office._store.get_display_overrides()
        except Exception:
            logger.exception("Could not load sandbox display overrides")

    live_by_name = {
        sandbox.get("name"): sandbox
        for sandbox in status.get("sandboxes", [])
        if isinstance(sandbox.get("name"), str)
    }
    live_inference = status.get("liveInference")
    if not isinstance(live_inference, dict):
        live_inference = {}

    sandboxes = []
    for workspace in SANDBOX_WORKSPACES:
        name = workspace.name
        live = live_by_name.get(name, {})
        assigned_names = assignments.get(name, [])
        item = {
            **live,
            "name": name,
            "display_name": overrides.get(name, workspace.display_name),
            "default_display_name": workspace.display_name,
            "model": live.get("model") or live_inference.get("model"),
            "provider": live.get("provider") or live_inference.get("provider"),
            "policies": live.get("policies") or [],
            "phase": live.get("phase") or ("live" if live else "configured"),
            "isDefault": bool(live.get("isDefault") or status.get("defaultSandbox") == name),
            "configured": True,
            "assignable": True,
            "live": bool(live),
            "home_room": workspace.home_room,
            "assigned_agents": assigned_names,
            "assigned_agent_details": [
                agents_by_name[a]
                for a in assigned_names
                if a in agents_by_name
            ],
            "run_status": run_statuses.get(name),
        }
        sandboxes.append(item)

    return {
        "available": status.get("available", False),
        "nemoclaw_path": status.get("nemoclaw_path"),
        "openshell_path": status.get("openshell_path"),
        "gatewayHealth": status.get("gatewayHealth"),
        "liveInference": status.get("liveInference"),
        "defaultSandbox": status.get("defaultSandbox"),
        "error": status.get("error"),
        "sandboxes": sandboxes,
    }


@router.post("/sandboxes/{sandbox_name}/display-name")
async def set_sandbox_display_name(sandbox_name: str, req: dict) -> dict[str, object]:
    """Persist a user-supplied display name for one sandbox.

    Body: {"display_name": "<text>"} — pass an empty string to reset to the
    claw_config default. Internal sandbox names never change here; only the
    label shown in the UI.
    """
    raw = req.get("display_name") if isinstance(req, dict) else None
    if raw is not None and not isinstance(raw, str):
        raise HTTPException(status_code=400, detail="display_name must be a string")

    workspace = next((w for w in SANDBOX_WORKSPACES if w.name == sandbox_name), None)
    if workspace is None:
        raise HTTPException(status_code=404, detail=f"Unknown sandbox {sandbox_name}")

    office = app_state.require_office_state()
    if not office._store:
        raise HTTPException(status_code=503, detail="Persistent store not initialized")

    cleaned = (raw or "").strip()[:80]
    if not cleaned:
        await office._store.clear_display_override(sandbox_name)
        effective = workspace.display_name
    else:
        await office._store.set_display_override(sandbox_name, cleaned)
        effective = cleaned

    # Broadcast a sandbox_renamed event so all WS clients refresh without polling.
    broadcaster = app_state.broadcaster
    if broadcaster:
        from datetime import datetime
        await broadcaster.broadcast({
            "type": "sandbox_renamed",
            "sandbox_name": sandbox_name,
            "display_name": effective,
            "timestamp": datetime.now().isoformat(),
        })

    return {"status": "ok", "sandbox_name": sandbox_name, "display_name": effective}


@router.post("/sandboxes/{sandbox_name}/team")
async def assign_sandbox_team(sandbox_name: str, req: SandboxTeamRequest) -> dict[str, object]:
    orch = app_state.require_orchestrator()
    try:
        assignments = await orch.assign_sandbox_team(
            sandbox_name=sandbox_name,
            agent_names=req.agent_names,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        # Active run blocks reassignment — 409 Conflict is the honest code here.
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"status": "ok", "sandbox_name": sandbox_name, "assignments": assignments}


@router.post("/sandboxes/{sandbox_name}/task")
async def run_sandbox_task(sandbox_name: str, req: SandboxTaskRequest) -> dict[str, object]:
    orch = app_state.require_orchestrator()

    status = await get_nemoclaw_status()
    live_names = {
        sandbox.get("name")
        for sandbox in status.get("sandboxes", [])
        if isinstance(sandbox.get("name"), str)
    }
    if sandbox_name not in live_names:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{sandbox_name} is configured for the demo but the NemoClaw CLI does not "
                "show it as a live sandbox. Run the backend on the Spark host and verify "
                "nemoclaw is on PATH."
            ),
        )

    task = req.task.strip()
    if not task:
        raise HTTPException(status_code=400, detail="Empty task")
    try:
        run_id = await orch.run_sandbox_team_task(
            sandbox_name=sandbox_name,
            task=task,
            agent_names=req.agent_names,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "started", "run_id": run_id, "sandbox_name": sandbox_name}


@router.post("/sandboxes/{sandbox_name}/task/{run_id}/cancel")
async def cancel_sandbox_task(sandbox_name: str, run_id: str) -> dict[str, object]:
    return await app_state.require_orchestrator().cancel_sandbox_team_task(
        sandbox_name=sandbox_name,
        run_id=run_id,
    )


@router.post("/sandboxes/{sandbox_name}/clear")
async def clear_sandbox(sandbox_name: str) -> dict[str, object]:
    orch = app_state.require_orchestrator()
    run_status = orch.get_sandbox_run_statuses().get(sandbox_name)
    if run_status and run_status.get("running"):
        raise HTTPException(
            status_code=409,
            detail="Stop the active run before clearing this sandbox.",
        )

    result = await clear_sandbox_state(sandbox_name)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Sandbox clear failed")

    orch.clear_sandbox_run_status(sandbox_name)
    broadcaster = app_state.broadcaster
    if broadcaster:
        from datetime import datetime
        await broadcaster.broadcast({
            "type": "sandbox_cleared",
            "sandbox_name": sandbox_name,
            "archive": result.get("archive"),
            "timestamp": datetime.now().isoformat(),
        })
    return result


@router.get("/sandboxes/{sandbox_name}/policies")
async def list_sandbox_policies(sandbox_name: str) -> dict[str, object]:
    return await get_policy_presets(sandbox_name)


@router.post("/sandboxes/{sandbox_name}/policies")
async def update_sandbox_policy(sandbox_name: str, req: SandboxPolicyRequest) -> dict[str, object]:
    result = await set_policy_preset(
        sandbox_name,
        req.preset,
        enabled=req.enabled,
        dry_run=req.dry_run,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Policy update failed")
    return result


@router.get("/approvals")
async def list_approvals(sandbox_name: str | None = None) -> dict[str, object]:
    return await get_openclaw_approvals(sandbox_name)
