"""Hermes runtime bridge for crab agents.

Crabs are intentionally honest: they are routed to this bridge, not silently
back through OpenClaw. Until a demo host provides ``OFFICE_AGENTS_HERMES_COMMAND``,
the bridge returns a structured configuration error that the existing run
diagnostics UI can display.
"""

from __future__ import annotations

import os
from typing import Any

from ._subprocess import run_capture
from .nemoclaw import _which
from ..config import settings


def _failure(
    *,
    sandbox_name: str,
    agent_name: str,
    message: str,
    mode: str,
    timed_out: bool = False,
) -> dict[str, Any]:
    return {
        "success": False,
        "output": message,
        "failure_kind": mode,
        "failure_detail": message,
        "timed_out": timed_out,
        "execution_mode": "hermes",
        "sandbox_name": sandbox_name,
        "diagnostics": {
            "failure_kind": mode,
            "failure_detail": message,
            "timed_out": timed_out,
            "runtime": "hermes",
            "agent": agent_name,
        },
    }


async def run_hermes(
    task: str,
    *,
    sandbox_name: str,
    agent_name: str,
    role_label: str,
    personality: str | None = None,
    working_dir: str | None = None,
    timeout_seconds: int | None = None,
) -> dict[str, Any]:
    """Run a Hermes command inside an OpenShell sandbox."""
    command = settings.hermes_command.strip()
    if not command:
        return _failure(
            sandbox_name=sandbox_name,
            agent_name=agent_name,
            message=(
                "Hermes crab runtime is not configured. Set "
                "OFFICE_AGENTS_HERMES_COMMAND on the backend host to enable crab runs."
            ),
            mode="hermes_not_configured",
        )

    openshell = _which("openshell")
    if not openshell:
        return _failure(
            sandbox_name=sandbox_name,
            agent_name=agent_name,
            message="openshell CLI not found on PATH. Run the backend on the NemoClaw/OpenShell host.",
            mode="cli_missing",
        )

    timeout = timeout_seconds or settings.hermes_timeout_seconds
    env = os.environ.copy()
    env.update({
        "HERMES_TASK": task,
        "HERMES_AGENT_NAME": agent_name,
        "HERMES_ROLE": role_label,
        "HERMES_PERSONALITY": personality or "",
    })
    run = await run_capture(
        openshell,
        "sandbox",
        "exec",
        "--name",
        sandbox_name,
        "--workdir",
        "/sandbox",
        "--timeout",
        str(timeout + 30),
        "--",
        "sh",
        "-lc",
        'mkdir -p "$1" && cd "$1" && exec sh -lc "$2"',
        "hermes-runner",
        working_dir or f"/sandbox/runs/hermes/{agent_name.lower().replace(' ', '-')}",
        command,
        timeout_seconds=timeout + 45,
        env=env,
    )
    output = (run.stdout or run.stderr).strip()
    if run.timed_out:
        return _failure(
            sandbox_name=sandbox_name,
            agent_name=agent_name,
            message=f"Hermes timed out after {timeout}s.",
            mode="hermes_timeout",
            timed_out=True,
        )
    if run.returncode != 0:
        return _failure(
            sandbox_name=sandbox_name,
            agent_name=agent_name,
            message=output or f"Hermes exited with code {run.returncode}.",
            mode="hermes_failed",
        )
    return {
        "success": True,
        "output": output or "Hermes completed without visible output.",
        "execution_mode": "hermes",
        "sandbox_name": sandbox_name,
        "diagnostics": {
            "runtime": "hermes",
            "agent": agent_name,
        },
    }
