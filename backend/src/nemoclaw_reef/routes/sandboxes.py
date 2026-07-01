"""NemoClaw sandbox endpoints — listing, team assignment, task runs, policies."""

from __future__ import annotations

import logging
import base64
import mimetypes
import re
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, HTTPException, Response

from nemoclaw_reef.claw_config import SANDBOX_WORKSPACES, SandboxWorkspace
from nemoclaw_reef.config import settings
from nemoclaw_reef.infra.app_state import app_state
from nemoclaw_reef.models import (
    NetworkRuleApproveAllRequest,
    NetworkRuleDecisionRequest,
    SandboxCreateRequest,
    SandboxPolicyRequest,
    SandboxTaskRequest,
    SandboxTeamRequest,
    WebSearchProviderRequest,
)
from nemoclaw_reef.integrations.nemoclaw_cli import (
    approve_all_network_rules,
    create_nemoclaw_sandbox,
    clear_sandbox_state,
    clear_pending_network_rules,
    decide_network_rule,
    get_nemoclaw_status,
    get_network_rules,
    get_openclaw_approvals,
    get_policy_presets,
    get_web_search_status,
    list_task_artifacts,
    read_task_artifact,
    set_policy_preset,
    set_web_search_provider,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_SAFE_SANDBOX_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")
_SECRET_OUTPUT_RE = re.compile(
    r"(?i)((?:api[_-]?key|token|secret|password|credential)\s*(?:=|:|\s)\s*)\S+"
)


def _slugify_label(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:48].strip("-") or "sandbox"


def _display_name_from_sandbox_name(sandbox_name: str) -> str:
    raw = sandbox_name.removeprefix("nemoclaw-").replace("-", " ").replace("_", " ")
    return raw.title() or sandbox_name


def _live_workspace_for_sandbox(sandbox_name: str) -> SandboxWorkspace:
    slug = _slugify_label(sandbox_name.removeprefix("nemoclaw-"))
    return SandboxWorkspace(
        name=sandbox_name,
        home_room=f"sandbox_live_{slug}",
        display_name=_display_name_from_sandbox_name(sandbox_name),
        source="live",
    )


async def _configured_workspaces() -> list[SandboxWorkspace]:
    """Starter workspaces plus user-created registry rows from SQLite."""
    workspaces = list(SANDBOX_WORKSPACES)
    seen = {workspace.name for workspace in workspaces}
    reef = app_state.reef_state
    store = reef.get_store() if reef else None
    if not store:
        return workspaces
    try:
        rows = await store.list_sandbox_workspaces()
    except Exception:
        logger.exception("Could not load dynamic sandbox workspaces")
        return workspaces
    for row in rows:
        name = str(row.get("sandbox_name") or "").strip()
        home_room = str(row.get("home_room") or "").strip()
        display_name = str(row.get("display_name") or "").strip()
        if not name or not home_room or not display_name or name in seen:
            continue
        workspaces.append(
            SandboxWorkspace(
                name=name,
                home_room=home_room,
                display_name=display_name,
                source=str(row.get("source") or "user"),
            )
        )
        seen.add(name)
    return workspaces


async def _visible_workspaces(
    status: dict[str, object] | None = None,
    *,
    include_unregistered_live: bool | None = None,
) -> list[SandboxWorkspace]:
    """Configured workspaces plus live OpenShell sandboxes missing from SQLite.

    Dynamic workspace rows are the durable source for UI names/rooms. Live-only
    sandboxes are hidden by default so the booth starts with the four starter
    huts. Operators can still expose live-only sandboxes by setting
    NEMOCLAW_REEF_SHOW_UNREGISTERED_LIVE_SANDBOXES=true or passing the explicit
    query flag on /sandboxes.
    """

    workspaces = await _configured_workspaces()
    if include_unregistered_live is None:
        include_unregistered_live = settings.show_unregistered_live_sandboxes
    if not include_unregistered_live:
        return workspaces

    seen = {workspace.name for workspace in workspaces}
    live_status = status if status is not None else await get_nemoclaw_status()
    live_sandboxes = live_status.get("sandboxes", [])
    if not isinstance(live_sandboxes, list):
        return workspaces

    for sandbox in live_sandboxes:
        if not isinstance(sandbox, dict):
            continue
        name = sandbox.get("name")
        if not isinstance(name, str) or not name or name in seen:
            continue
        workspaces.append(_live_workspace_for_sandbox(name))
        seen.add(name)
    return workspaces


def _sync_orchestrator_workspaces(workspaces: list[SandboxWorkspace]) -> None:
    orch = app_state.orchestrator
    if orch:
        orch.sandboxes.sync_sandbox_workspaces(workspaces)


async def _refresh_orchestrator_workspaces() -> list[SandboxWorkspace]:
    workspaces = await _visible_workspaces()
    _sync_orchestrator_workspaces(workspaces)
    return workspaces


def _sanitize_cli_message(value: object, *, limit: int = 1200) -> str:
    text = str(value or "").strip()
    text = _SECRET_OUTPUT_RE.sub(r"\1<redacted>", text)
    return text[:limit].rstrip()


async def _provision_created_sandbox(
    sandbox_name: str,
    display_name: str,
    home_room: str,
) -> None:
    broadcaster = app_state.broadcaster
    if broadcaster:
        await broadcaster.broadcast({
            "type": "sandbox_provision_started",
            "sandbox_name": sandbox_name,
            "display_name": display_name,
            "home_room": home_room,
            "timestamp": datetime.now().isoformat(),
        })

    logger.info("Provisioning dynamic NemoClaw sandbox %s", sandbox_name)
    result = await create_nemoclaw_sandbox(sandbox_name)
    ok = bool(result.get("ok"))
    if ok:
        logger.info("Provisioned dynamic NemoClaw sandbox %s", sandbox_name)
    else:
        logger.warning(
            "Dynamic NemoClaw sandbox %s provisioning failed: %s",
            sandbox_name,
            _sanitize_cli_message(result.get("error") or result.get("output")),
        )

    try:
        _sync_orchestrator_workspaces(await _configured_workspaces())
    except Exception:
        logger.exception("Could not resync workspaces after provisioning %s", sandbox_name)

    if broadcaster:
        error = None if ok else _sanitize_cli_message(result.get("error") or result.get("output"))
        await broadcaster.broadcast({
            "type": "sandbox_provision_finished",
            "sandbox_name": sandbox_name,
            "display_name": display_name,
            "home_room": home_room,
            "ok": ok,
            "error": error,
            "timestamp": datetime.now().isoformat(),
        })
        if error:
            await broadcaster.broadcast({
                "type": "system_warning",
                "message": f"{display_name} provisioning failed: {error}",
            })


def _next_sandbox_name(
    display_name: str,
    *,
    requested_name: str | None,
    reserved: set[str],
) -> str:
    if requested_name:
        cleaned = requested_name.strip()
        if not cleaned.startswith("nemoclaw-"):
            cleaned = f"nemoclaw-{cleaned}"
        cleaned = cleaned.lower().replace("_", "-")
        if not _SAFE_SANDBOX_NAME.match(cleaned):
            raise HTTPException(status_code=400, detail="sandbox_name contains invalid characters")
        if cleaned in reserved:
            raise HTTPException(status_code=409, detail=f"Sandbox {cleaned} already exists")
        return cleaned

    base = f"nemoclaw-{_slugify_label(display_name)}"
    name = base
    suffix = 2
    while name in reserved:
        name = f"{base}-{suffix}"
        suffix += 1
    return name


@router.get("/sandboxes")
async def get_sandboxes(include_unregistered_live: bool | None = None) -> dict[str, object]:
    """Merge configured workspaces with live nemoclaw status + run/team state."""

    status = await get_nemoclaw_status()
    workspaces = await _visible_workspaces(
        status,
        include_unregistered_live=include_unregistered_live,
    )
    _sync_orchestrator_workspaces(workspaces)

    orch = app_state.orchestrator
    reef = app_state.reef_state
    assignments = orch.get_sandbox_assignments() if orch else {}
    run_statuses = orch.get_sandbox_run_statuses() if orch else {}
    agents_by_name = {a.name: a.to_info() for a in orch.agents} if orch else {}

    # User-defined display names override the claw_config defaults.
    overrides: dict[str, str] = {}
    if reef and reef._store:
        try:
            overrides = await reef._store.get_display_overrides()
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
    for workspace in workspaces:
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
            "source": workspace.source,
            "assigned_agents": assigned_names,
            "assigned_agent_details": [
                agents_by_name[a]
                for a in assigned_names
                if a in agents_by_name
            ],
            "run_status": run_statuses.get(name),
        }
        readiness_issues: list[str] = []
        if not item["live"]:
            readiness_issues.append("Sandbox is configured but not live.")
        gateway = status.get("gatewayHealth")
        if isinstance(gateway, dict) and not gateway.get("healthy"):
            readiness_issues.append(f"Gateway is {gateway.get('state') or 'unhealthy'}.")
        if not live_inference:
            readiness_issues.append("No live inference endpoint reported by NemoClaw.")
        item["readiness"] = {
            "ok": len(readiness_issues) == 0,
            "live": item["live"],
            "gateway": gateway if isinstance(gateway, dict) else None,
            "inference": live_inference or None,
            "issues": readiness_issues,
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


@router.post("/sandboxes")
async def create_sandbox(
    req: SandboxCreateRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, object]:
    """Create/register a new NemoClaw sandbox workspace for this demo device."""
    display_name = req.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="display_name cannot be empty")

    reef = app_state.require_reef_state()
    store = reef.get_store()
    if not store:
        raise HTTPException(status_code=503, detail="Persistent store not initialized")

    workspaces = await _configured_workspaces()
    status = await get_nemoclaw_status()
    live_names = {
        sandbox.get("name")
        for sandbox in status.get("sandboxes", [])
        if isinstance(sandbox.get("name"), str)
    }
    reserved = {workspace.name for workspace in workspaces}
    reserved.update(name for name in live_names if isinstance(name, str))
    sandbox_name = _next_sandbox_name(
        display_name,
        requested_name=req.sandbox_name,
        reserved=reserved,
    )
    home_room = f"sandbox_custom_{_slugify_label(sandbox_name.removeprefix('nemoclaw-'))}"

    await store.add_sandbox_workspace(
        sandbox_name=sandbox_name,
        display_name=display_name,
        home_room=home_room,
    )
    workspaces = await _configured_workspaces()
    _sync_orchestrator_workspaces(workspaces)

    broadcaster = app_state.broadcaster
    if broadcaster:
        await broadcaster.broadcast({
            "type": "sandbox_created",
            "sandbox_name": sandbox_name,
            "display_name": display_name,
            "home_room": home_room,
            "provisioning": bool(req.provision),
            "timestamp": datetime.now().isoformat(),
        })

    if req.provision:
        background_tasks.add_task(
            _provision_created_sandbox,
            sandbox_name,
            display_name,
            home_room,
        )

    return {
        "status": "provisioning" if req.provision else "ok",
        "sandbox": {
            "name": sandbox_name,
            "display_name": display_name,
            "default_display_name": display_name,
            "home_room": home_room,
            "configured": True,
            "assignable": True,
            "live": False,
            "provisioning": bool(req.provision),
            "source": "user",
            "assigned_agents": [],
        },
        "provision": (
            {"ok": None, "status": "started", "background": True}
            if req.provision
            else None
        ),
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

    workspaces = await _configured_workspaces()
    _sync_orchestrator_workspaces(workspaces)
    workspace = next((w for w in workspaces if w.name == sandbox_name), None)
    if workspace is None:
        raise HTTPException(status_code=404, detail=f"Unknown sandbox {sandbox_name}")

    reef = app_state.require_reef_state()
    if not reef._store:
        raise HTTPException(status_code=503, detail="Persistent store not initialized")

    cleaned = (raw or "").strip()[:80]
    if not cleaned:
        await reef._store.clear_display_override(sandbox_name)
        effective = workspace.display_name
    else:
        await reef._store.set_display_override(sandbox_name, cleaned)
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
    await _refresh_orchestrator_workspaces()
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
    await _refresh_orchestrator_workspaces()

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
                "show it as a live sandbox. Create/start this sandbox on the backend host "
                "and verify nemoclaw is on PATH."
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
    return await get_policy_presets(sandbox_name, include_checks=True)


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


@router.get("/sandboxes/{sandbox_name}/network-rules")
async def list_network_rules(
    sandbox_name: str,
    status: str = "all",
) -> dict[str, object]:
    result = await get_network_rules(sandbox_name, status=status)
    if result.get("error") and not result.get("rules"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@router.post("/sandboxes/{sandbox_name}/network-rules/{chunk_id}/decision")
async def update_network_rule_decision(
    sandbox_name: str,
    chunk_id: str,
    req: NetworkRuleDecisionRequest,
) -> dict[str, object]:
    result = await decide_network_rule(
        sandbox_name,
        chunk_id,
        decision=req.decision,
    )
    if not result.get("ok"):
        raise HTTPException(
            status_code=400,
            detail=result.get("error") or "Network rule decision failed",
        )
    return result


@router.post("/sandboxes/{sandbox_name}/network-rules/approve-all")
async def approve_all_sandbox_network_rules(
    sandbox_name: str,
    req: NetworkRuleApproveAllRequest,
) -> dict[str, object]:
    result = await approve_all_network_rules(
        sandbox_name,
        include_security_flagged=req.include_security_flagged,
    )
    if not result.get("ok"):
        raise HTTPException(
            status_code=400,
            detail=result.get("error") or "Network rule approve-all failed",
        )
    return result


@router.post("/sandboxes/{sandbox_name}/network-rules/clear-pending")
async def clear_sandbox_pending_network_rules(sandbox_name: str) -> dict[str, object]:
    result = await clear_pending_network_rules(sandbox_name)
    if not result.get("ok"):
        raise HTTPException(
            status_code=400,
            detail=result.get("error") or "Network rule clear failed",
        )
    return result


@router.get("/sandboxes/{sandbox_name}/web-search")
async def get_sandbox_web_search(sandbox_name: str) -> dict[str, object]:
    result = await get_web_search_status(sandbox_name)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Web search status failed")
    return result


@router.post("/sandboxes/{sandbox_name}/web-search")
async def update_sandbox_web_search(
    sandbox_name: str,
    req: WebSearchProviderRequest,
) -> dict[str, object]:
    result = await set_web_search_provider(
        sandbox_name,
        provider=req.provider,
        ollama_base_url=req.ollama_base_url,
        rebuild_sandbox=req.rebuild_sandbox,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Web search setup failed")
    return result


@router.get("/sandboxes/{sandbox_name}/tasks/{run_id}/diagnostics")
async def get_sandbox_task_diagnostics(sandbox_name: str, run_id: str) -> dict[str, object]:
    diagnostics = app_state.require_orchestrator().get_sandbox_run_diagnostics(
        sandbox_name=sandbox_name,
        run_id=run_id,
    )
    if diagnostics is None:
        raise HTTPException(status_code=404, detail="Run diagnostics not found")
    return diagnostics


@router.get("/sandboxes/{sandbox_name}/tasks/{run_id}/artifacts")
async def get_sandbox_task_artifacts(sandbox_name: str, run_id: str) -> dict[str, object]:
    result = await list_task_artifacts(sandbox_name, run_id)
    files = result.get("files") if isinstance(result.get("files"), list) else []
    for item in files:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "")
        encoded = "/".join(quote(part, safe="") for part in path.split("/") if part)
        item["url"] = f"/sandboxes/{sandbox_name}/tasks/{run_id}/artifacts/{encoded}"
    return result


@router.get("/sandboxes/{sandbox_name}/tasks/{run_id}/artifacts/{artifact_path:path}")
async def get_sandbox_task_artifact_file(
    sandbox_name: str,
    run_id: str,
    artifact_path: str,
) -> Response:
    result = await read_task_artifact(sandbox_name, run_id, artifact_path)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=str(result.get("error") or "Artifact not found"))
    try:
        content = base64.b64decode(str(result.get("b64") or ""), validate=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Artifact payload decode failed") from exc
    media_type = mimetypes.guess_type(artifact_path)[0] or "text/plain"
    return Response(content=content, media_type=media_type)
