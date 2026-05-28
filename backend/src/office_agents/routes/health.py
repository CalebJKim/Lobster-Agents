"""GET /health — diagnostics surface for the UI banner.

The frontend polls this and shows a red banner when anything required by the
demo is missing. Each component reports its own reachability + the specific
reason for failure so the user can fix it without grepping logs.
"""

from __future__ import annotations

import logging
import shutil
from typing import Any

from fastapi import APIRouter

from office_agents.llm.client import LLMClient
from office_agents.sandbox_runtime.nemoclaw import get_nemoclaw_status

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
