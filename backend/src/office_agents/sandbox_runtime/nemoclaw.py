"""Helpers for inspecting NemoClaw/OpenShell state from the demo backend."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
from typing import Any

logger = logging.getLogger(__name__)

_SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")


def _which(command: str) -> str | None:
    found = shutil.which(command)
    if found:
        return found

    for directory in (
        os.path.expanduser("~/.local/bin"),
        "/home/nvidia/.local/bin",
        "/usr/local/bin",
    ):
        candidate = os.path.join(directory, command)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


async def get_nemoclaw_status(timeout_seconds: int = 12) -> dict[str, Any]:
    """Return NemoClaw status JSON with conservative fallbacks."""
    nemoclaw_cmd = _which("nemoclaw")
    openshell_cmd = _which("openshell")

    if not nemoclaw_cmd:
        return {
            "available": False,
            "nemoclaw_path": None,
            "openshell_path": openshell_cmd,
            "gatewayHealth": {"healthy": False, "state": "nemoclaw_missing"},
            "liveInference": None,
            "sandboxes": [],
            "error": "NemoClaw CLI was not found on PATH.",
        }

    proc = await asyncio.create_subprocess_exec(
        nemoclaw_cmd,
        "status",
        "--json",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(), timeout=timeout_seconds
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        return {
            "available": True,
            "nemoclaw_path": nemoclaw_cmd,
            "openshell_path": openshell_cmd,
            "gatewayHealth": {"healthy": False, "state": "status_timeout"},
            "liveInference": None,
            "sandboxes": [],
            "error": f"nemoclaw status timed out after {timeout_seconds}s.",
        }

    stdout = stdout_bytes.decode("utf-8", errors="replace")
    stderr = stderr_bytes.decode("utf-8", errors="replace")

    if proc.returncode != 0:
        logger.warning("nemoclaw status failed: %s", stderr[:500])
        return {
            "available": True,
            "nemoclaw_path": nemoclaw_cmd,
            "openshell_path": openshell_cmd,
            "gatewayHealth": {"healthy": False, "state": "status_failed"},
            "liveInference": None,
            "sandboxes": [],
            "error": stderr or stdout,
        }

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        logger.warning("Could not parse nemoclaw status output: %s", stdout[:500])
        return {
            "available": True,
            "nemoclaw_path": nemoclaw_cmd,
            "openshell_path": openshell_cmd,
            "gatewayHealth": {"healthy": False, "state": "invalid_status_json"},
            "liveInference": None,
            "sandboxes": [],
            "error": stdout[:1000],
        }

    data["available"] = True
    data["nemoclaw_path"] = nemoclaw_cmd
    data["openshell_path"] = openshell_cmd
    return data


async def get_policy_presets(sandbox_name: str, timeout_seconds: int = 12) -> dict[str, Any]:
    """Return all policy presets for a sandbox, including enabled state."""
    if not _SAFE_NAME.match(sandbox_name):
        return {"error": "Invalid sandbox name", "policies": []}

    nemoclaw_cmd = _which("nemoclaw")
    if not nemoclaw_cmd:
        return {"error": "NemoClaw CLI was not found on PATH.", "policies": []}

    proc = await asyncio.create_subprocess_exec(
        nemoclaw_cmd,
        sandbox_name,
        "policy-list",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(), timeout=timeout_seconds
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        return {"error": f"policy-list timed out after {timeout_seconds}s", "policies": []}

    stdout = stdout_bytes.decode("utf-8", errors="replace")
    stderr = stderr_bytes.decode("utf-8", errors="replace")
    output = stdout or stderr
    policies = []

    for line in output.splitlines():
        stripped = line.strip()
        if not stripped.startswith(("●", "○")):
            continue
        enabled = stripped.startswith("●")
        body = stripped[1:].strip()
        if "—" in body:
            name, description = [part.strip() for part in body.split("—", 1)]
        elif "-" in body:
            name, description = [part.strip() for part in body.split("-", 1)]
        else:
            name, description = body, ""
        policies.append({
            "name": name,
            "description": description,
            "enabled": enabled,
        })

    return {
        "sandbox_name": sandbox_name,
        "policies": policies,
        "raw": output,
        "error": None if proc.returncode == 0 else output,
    }


async def set_policy_preset(
    sandbox_name: str,
    preset: str,
    *,
    enabled: bool,
    dry_run: bool,
    timeout_seconds: int = 90,
) -> dict[str, Any]:
    """Add or remove one NemoClaw policy preset."""
    if not _SAFE_NAME.match(sandbox_name):
        return {"ok": False, "error": "Invalid sandbox name"}
    if not _SAFE_NAME.match(preset):
        return {"ok": False, "error": "Invalid policy preset"}

    nemoclaw_cmd = _which("nemoclaw")
    if not nemoclaw_cmd:
        return {"ok": False, "error": "NemoClaw CLI was not found on PATH."}

    cmd = [
        nemoclaw_cmd,
        sandbox_name,
        "policy-add" if enabled else "policy-remove",
        preset,
        "--dry-run" if dry_run else "--yes",
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(), timeout=timeout_seconds
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "preset": preset,
            "enabled": enabled,
            "dry_run": dry_run,
            "error": f"policy update timed out after {timeout_seconds}s",
        }

    stdout = stdout_bytes.decode("utf-8", errors="replace")
    stderr = stderr_bytes.decode("utf-8", errors="replace")
    return {
        "ok": proc.returncode == 0,
        "sandbox_name": sandbox_name,
        "preset": preset,
        "enabled": enabled,
        "dry_run": dry_run,
        "output": (stdout or stderr).strip(),
        "error": None if proc.returncode == 0 else (stderr or stdout),
    }


async def get_openclaw_approvals(
    sandbox_name: str | None = None,
    timeout_seconds: int = 20,
) -> dict[str, Any]:
    """Return host approval config plus optional sandbox effective-policy text."""
    approvals_path = os.path.expanduser("~/.openclaw/exec-approvals.json")
    if not os.path.exists(approvals_path) and os.path.exists("/home/nvidia/.openclaw/exec-approvals.json"):
        approvals_path = "/home/nvidia/.openclaw/exec-approvals.json"

    snapshot: Any = None
    error: str | None = None
    if os.path.exists(approvals_path):
        try:
            with open(approvals_path, "r") as f:
                snapshot = json.load(f)
        except Exception as exc:  # pragma: no cover - defensive for corrupt local state
            error = str(exc)

    effective_policy = ""
    if sandbox_name and _SAFE_NAME.match(sandbox_name):
        openshell_cmd = _which("openshell")
        if openshell_cmd:
            proc = await asyncio.create_subprocess_exec(
                openshell_cmd,
                "sandbox",
                "exec",
                "--name",
                sandbox_name,
                "--timeout",
                str(timeout_seconds),
                "--",
                "openclaw",
                "exec-policy",
                "show",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout_seconds + 5
                )
                effective_policy = (
                    stdout_bytes.decode("utf-8", errors="replace")
                    or stderr_bytes.decode("utf-8", errors="replace")
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                effective_policy = f"openclaw exec-policy show timed out after {timeout_seconds}s"

    return {
        "approvals_path": approvals_path if os.path.exists(approvals_path) else None,
        "snapshot": snapshot,
        "error": error,
        "sandbox_name": sandbox_name,
        "effective_policy": effective_policy,
    }
