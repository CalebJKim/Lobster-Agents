"""GET /health — diagnostics surface for the UI banner.

The frontend polls this and shows a red banner when anything required by the
demo is missing. Each component reports its own reachability + the specific
reason for failure so the user can fix it without grepping logs.
"""

from __future__ import annotations

import logging
import shutil
from datetime import datetime
from typing import Any

from fastapi import APIRouter

from office_agents.claw_config import SANDBOX_WORKSPACES
from office_agents.config import settings
from office_agents.llm.client import LLMClient
from office_agents.sandbox_runtime.nemoclaw import (
    get_nemoclaw_status,
    get_network_rules,
    get_policy_presets,
    probe_sandbox_inference,
)

logger = logging.getLogger(__name__)

router = APIRouter()


_llm_client: LLMClient | None = None


def attach_llm_client(client: LLMClient) -> None:
    """Called once from app startup so /health can ping the LLM."""
    global _llm_client
    _llm_client = client


def _check_cli(name: str) -> dict[str, Any]:
    """Locate a CLI on PATH and report where (or why not)."""
    found = shutil.which(name)
    if found:
        return {"ok": True, "path": found, "error": None}
    return {
        "ok": False,
        "path": None,
        "error": f"{name!r} not found on PATH",
    }


@router.get("/health")
async def health() -> dict[str, Any]:
    """One-shot health check: LLM, openshell CLI, nemoclaw CLI, sandboxes.

    Always returns 200 — the response body carries the status. The frontend
    decides whether to show a banner based on `ok`.
    """
    llm: dict[str, Any]
    if _llm_client is None:
        llm = {"reachable": False, "error": "LLM client not initialized"}
    else:
        # 6s gives vLLM enough headroom to answer /v1/models even when it's
        # mid-batch on parallel agent calls. The default 2s was tight under
        # load and produced flickers of "LLM unreachable" in the UI banner
        # despite chat itself working fine.
        llm = dict(await _llm_client.ping(timeout_seconds=6.0))

    openshell = _check_cli("openshell")
    nemoclaw = _check_cli("nemoclaw")

    # Probe nemoclaw status only when the CLI is actually present — otherwise
    # we'd block on a subprocess timeout for ~5s on every health poll.
    sandboxes_status: dict[str, Any]
    if nemoclaw["ok"]:
        try:
            raw = await get_nemoclaw_status()
            sandboxes_status = {
                "available": bool(raw.get("available")),
                "count": len(raw.get("sandboxes", []) or []),
                "default": raw.get("defaultSandbox"),
                "error": raw.get("error"),
            }
        except Exception as exc:
            sandboxes_status = {"available": False, "count": 0, "default": None, "error": str(exc)}
    else:
        sandboxes_status = {
            "available": False,
            "count": 0,
            "default": None,
            "error": "nemoclaw CLI missing",
        }

    components = {
        "llm": llm,
        "openshell": openshell,
        "nemoclaw": nemoclaw,
        "sandboxes": sandboxes_status,
    }

    return {
        "ok": not _failures(components),
        "failing": _failures(components),
        "components": components,
    }


@router.get("/demo/readiness")
async def demo_readiness(sandbox_name: str | None = None) -> dict[str, Any]:
    """Aggregated pre-demo checklist for the UI.

    This endpoint is intentionally read-only and redacted: it reports presence,
    counts, and command health, never secret values or raw approval files.
    """

    checks: list[dict[str, Any]] = []

    def add(check_id: str, label: str, status: str, detail: str = "", data: dict[str, Any] | None = None) -> None:
        checks.append({
            "id": check_id,
            "label": label,
            "status": status,
            "detail": detail,
            "data": data or {},
        })

    health_body = await health()
    components = health_body.get("components", {})
    add("backend", "Backend API", "ok", "FastAPI is responding.")

    llm = components.get("llm", {}) if isinstance(components.get("llm"), dict) else {}
    if llm.get("reachable") and llm.get("model_loaded") is not False:
        add("llm", "Model endpoint", "ok", f"{llm.get('model') or 'model'} is reachable.")
    else:
        add("llm", "Model endpoint", "fail", str(llm.get("error") or "model is not reachable"), {"model": llm.get("model")})

    openshell = components.get("openshell", {}) if isinstance(components.get("openshell"), dict) else {}
    add(
        "openshell",
        "OpenShell CLI",
        "ok" if openshell.get("ok") else "fail",
        str(openshell.get("path") or openshell.get("error") or "not found"),
    )

    nemoclaw = components.get("nemoclaw", {}) if isinstance(components.get("nemoclaw"), dict) else {}
    add(
        "nemoclaw",
        "NemoClaw CLI",
        "ok" if nemoclaw.get("ok") else "fail",
        str(nemoclaw.get("path") or nemoclaw.get("error") or "not found"),
    )

    status = await get_nemoclaw_status()
    live_sandboxes = [
        sandbox for sandbox in status.get("sandboxes", [])
        if isinstance(sandbox, dict) and isinstance(sandbox.get("name"), str)
    ]
    visible_starter_names = [workspace.name for workspace in SANDBOX_WORKSPACES]
    live_names = {sandbox["name"] for sandbox in live_sandboxes}
    visible_default = next(
        (name for name in visible_starter_names if name in live_names),
        None,
    )
    live_count = len(live_sandboxes)
    selected = (
        sandbox_name
        or visible_default
        or status.get("defaultSandbox")
        or (live_sandboxes[0].get("name") if live_sandboxes else None)
    )
    add(
        "live_sandboxes",
        "Live sandboxes",
        "ok" if live_count > 0 else "fail",
        f"{live_count} live sandbox{'es' if live_count != 1 else ''} detected.",
        {
            "count": live_count,
            "default": status.get("defaultSandbox"),
            "visible_default": visible_default,
        },
    )

    gateway = status.get("gatewayHealth") if isinstance(status.get("gatewayHealth"), dict) else {}
    add(
        "gateway",
        "OpenShell gateway",
        "ok" if gateway.get("healthy") else "fail",
        str(gateway.get("state") or "gateway state unknown"),
        {"healthy": gateway.get("healthy")},
    )

    live_inference = status.get("liveInference") if isinstance(status.get("liveInference"), dict) else {}
    add(
        "inference_route",
        "NemoClaw inference route",
        "ok" if live_inference else "fail",
        f"{live_inference.get('provider') or 'unknown'} / {live_inference.get('model') or 'unknown'}"
        if live_inference else "No live inference route reported.",
        live_inference,
    )

    policy_status: dict[str, Any] = {}
    network_rules: dict[str, Any] = {}
    inference_probe: dict[str, Any] = {}
    if isinstance(selected, str) and selected:
        policy_status = await get_policy_presets(selected, include_checks=True)
        add(
            "policy_list",
            "Policy command",
            "ok" if not policy_status.get("error") else "fail",
            str(policy_status.get("error") or f"{len(policy_status.get('policies') or [])} presets available."),
        )

        network_rules = await get_network_rules(selected, status="all")
        counts = network_rules.get("counts") if isinstance(network_rules.get("counts"), dict) else {}
        pending = int(counts.get("pending") or 0)
        add(
            "network_rules",
            "OpenShell network rules",
            "warn" if pending > 0 else "ok",
            f"{pending} pending rule recommendation{'s' if pending != 1 else ''}.",
            {"counts": counts},
        )

        inference_probe = await probe_sandbox_inference(selected)
        add(
            "sandbox_inference",
            "Sandbox to inference.local",
            "ok" if inference_probe.get("ok") else "fail",
            str(
                f"{inference_probe.get('model_count', 0)} model entries reachable."
                if inference_probe.get("ok")
                else inference_probe.get("error") or "probe failed"
            ),
        )
    else:
        add("policy_list", "Policy command", "fail", "No selected live sandbox.")
        add("network_rules", "OpenShell network rules", "fail", "No selected live sandbox.")
        add("sandbox_inference", "Sandbox to inference.local", "fail", "No selected live sandbox.")

    credential_checks = policy_status.get("credential_checks") if isinstance(policy_status, dict) else []
    missing_credentials = [
        check for check in credential_checks
        if isinstance(check, dict) and check.get("status") == "missing"
    ]
    if missing_credentials:
        add(
            "credentials",
            "Policy credentials",
            "warn",
            ", ".join(str(check.get("name")) for check in missing_credentials),
            {"missing": [{"policy": c.get("policy"), "name": c.get("name")} for c in missing_credentials]},
        )
    else:
        add("credentials", "Policy credentials", "ok", "No enabled policy credentials are missing.")

    hermes_configured = bool(settings.hermes_command.strip())
    add(
        "hermes",
        "Hermes crab runtime",
        "ok" if hermes_configured else "warn",
        "Hermes command configured." if hermes_configured else "Hermes command not configured; crabs are visual/build/assign only.",
        {"configured": hermes_configured},
    )

    fail_count = sum(1 for check in checks if check["status"] == "fail")
    warn_count = sum(1 for check in checks if check["status"] == "warn")
    return {
        "ok": fail_count == 0,
        "generated_at": datetime.now().isoformat(),
        "selected_sandbox": selected,
        "summary": {
            "ok": len(checks) - fail_count - warn_count,
            "warn": warn_count,
            "fail": fail_count,
            "total": len(checks),
        },
        "checks": checks,
        "policy_snapshot": {
            "enabled": [
                p.get("name") for p in policy_status.get("policies", [])
                if isinstance(p, dict) and p.get("enabled")
            ] if isinstance(policy_status, dict) else [],
            "credential_checks": credential_checks if isinstance(credential_checks, list) else [],
        },
        "network_rules": {
            "counts": network_rules.get("counts") if isinstance(network_rules, dict) else {},
            "error": network_rules.get("error") if isinstance(network_rules, dict) else None,
        },
        "inference_probe": inference_probe,
        "hermes": {"configured": hermes_configured},
    }


def _failures(components: dict[str, dict[str, Any]]) -> list[str]:
    """Return the names of components that are not fully usable right now."""

    failing: list[str] = []
    for name, comp in components.items():
        if name == "llm":
            # The LLM counts as down if it's unreachable OR the requested model
            # isn't loaded — without the model, every chat() call 404s and the
            # simulation falls back to templated narration. The user needs to
            # see that as a failure, not "LLM is fine."
            if not comp.get("reachable"):
                failing.append(name)
            elif comp.get("model_loaded") is False:
                failing.append(name)
        elif "ok" in comp:
            if not comp.get("ok"):
                failing.append(name)
        elif "available" in comp:
            if not comp.get("available"):
                failing.append(name)
    return failing
