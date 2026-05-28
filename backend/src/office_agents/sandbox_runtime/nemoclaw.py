"""Helpers for inspecting NemoClaw/OpenShell state from the demo backend."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
from typing import Any

from ._subprocess import run_capture
from ..config import settings

logger = logging.getLogger(__name__)

_SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")


def _which(command: str) -> str | None:
    """Locate *command* on PATH, falling back to a configurable list of bin
    directories. Defaults come from ``settings.extra_bin_paths`` (Spark host's
    NVIDIA layout); override via ``OFFICE_AGENTS_EXTRA_BIN_PATHS``.
    """
    found = shutil.which(command)
    if found:
        return found

    extra = [os.path.expanduser("~/.local/bin"), *settings.extra_bin_paths]
    for directory in extra:
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

    run = await run_capture(
        nemoclaw_cmd, "status", "--json", timeout_seconds=timeout_seconds
    )

    if run.timed_out:
        return {
            "available": True,
            "nemoclaw_path": nemoclaw_cmd,
            "openshell_path": openshell_cmd,
            "gatewayHealth": {"healthy": False, "state": "status_timeout"},
            "liveInference": None,
            "sandboxes": [],
            "error": f"nemoclaw status timed out after {timeout_seconds}s.",
        }

    if run.returncode != 0:
        logger.warning("nemoclaw status failed: %s", run.stderr[:500])
        return {
            "available": True,
            "nemoclaw_path": nemoclaw_cmd,
            "openshell_path": openshell_cmd,
            "gatewayHealth": {"healthy": False, "state": "status_failed"},
            "liveInference": None,
            "sandboxes": [],
            "error": run.stderr or run.stdout,
        }

    try:
        data = json.loads(run.stdout)
    except json.JSONDecodeError:
        logger.warning("Could not parse nemoclaw status output: %s", run.stdout[:500])
        return {
            "available": True,
            "nemoclaw_path": nemoclaw_cmd,
            "openshell_path": openshell_cmd,
            "gatewayHealth": {"healthy": False, "state": "invalid_status_json"},
            "liveInference": None,
            "sandboxes": [],
            "error": run.stdout[:1000],
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

    run = await run_capture(
        nemoclaw_cmd, sandbox_name, "policy-list", timeout_seconds=timeout_seconds
    )
    if run.timed_out:
        return {"error": f"policy-list timed out after {timeout_seconds}s", "policies": []}

    output = run.stdout or run.stderr
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
        "error": None if run.returncode == 0 else output,
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

    run = await run_capture(
        nemoclaw_cmd,
        sandbox_name,
        "policy-add" if enabled else "policy-remove",
        preset,
        "--dry-run" if dry_run else "--yes",
        timeout_seconds=timeout_seconds,
    )
    if run.timed_out:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "preset": preset,
            "enabled": enabled,
            "dry_run": dry_run,
            "error": f"policy update timed out after {timeout_seconds}s",
        }

    return {
        "ok": run.returncode == 0,
        "sandbox_name": sandbox_name,
        "preset": preset,
        "enabled": enabled,
        "dry_run": dry_run,
        "output": (run.stdout or run.stderr).strip(),
        "error": None if run.returncode == 0 else (run.stderr or run.stdout),
    }


async def clear_sandbox_state(
    sandbox_name: str,
    timeout_seconds: int = 45,
) -> dict[str, Any]:
    """Archive and wipe task workspaces inside one live NemoClaw sandbox.

    Conversation/session logs remain under /sandbox/.openclaw so they can be
    inspected later. The clear action targets only filesystem context that can
    distract future tasks: the sandbox workspaces and runs dirs configured in
    :data:`settings`.
    """
    if not _SAFE_NAME.match(sandbox_name):
        return {"ok": False, "error": "Invalid sandbox name"}

    openshell_cmd = _which("openshell")
    if not openshell_cmd:
        return {"ok": False, "error": "OpenShell CLI was not found on PATH."}

    # Validate the target paths look safe before splicing them into the Python
    # source we ship to the sandbox — defence in depth against an env-var
    # mistake injecting shell quotes / newlines via the clear script.
    workspaces = settings.sandbox_workspaces_dir
    runs = settings.sandbox_runs_dir
    if "'" in workspaces or "'" in runs or "\n" in workspaces or "\n" in runs:
        return {
            "ok": False,
            "error": "Sandbox paths contain unsafe characters; refusing to construct clear script.",
        }

    clear_py = (
        'exec("'
        "import json, os, shutil, time\\n"
        "archive = '/sandbox/archives/clear-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())\\n"
        f"targets = ['{workspaces}', '{runs}']\\n"
        "os.makedirs(archive, exist_ok=True)\\n"
        "cleared = []\\n"
        "archived_count = 0\\n"
        "for target in targets:\\n"
        "    os.makedirs(target, exist_ok=True)\\n"
        "    entries = [os.path.join(target, name) for name in os.listdir(target)]\\n"
        "    dst_root = os.path.join(archive, os.path.basename(target))\\n"
        "    os.makedirs(dst_root, exist_ok=True)\\n"
        "    for entry in entries:\\n"
        "        dst = os.path.join(dst_root, os.path.basename(entry))\\n"
        "        if os.path.isdir(entry) and not os.path.islink(entry):\\n"
        "            shutil.copytree(entry, dst, symlinks=True, ignore_dangling_symlinks=True)\\n"
        "        else:\\n"
        "            shutil.copy2(entry, dst, follow_symlinks=False)\\n"
        "        archived_count += 1\\n"
        "    for entry in entries:\\n"
        "        if os.path.isdir(entry) and not os.path.islink(entry):\\n"
        "            shutil.rmtree(entry)\\n"
        "        else:\\n"
        "            os.unlink(entry)\\n"
        "    cleared.append(target)\\n"
        "print(json.dumps({'ok': True, 'archive': archive, 'cleared': cleared, 'archived_count': archived_count}))\\n"
        '")'
    )

    run = await run_capture(
        openshell_cmd,
        "sandbox",
        "exec",
        "--name",
        sandbox_name,
        "--workdir",
        "/sandbox",
        "--timeout",
        str(timeout_seconds),
        "--",
        "python3",
        "-c",
        clear_py,
        timeout_seconds=timeout_seconds + 10,
    )
    if run.timed_out:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "error": f"sandbox clear timed out after {timeout_seconds}s",
        }

    if run.returncode != 0:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "error": run.stderr or run.stdout or f"openshell exited with code {run.returncode}",
        }

    try:
        parsed = json.loads(run.stdout)
    except json.JSONDecodeError:
        parsed = {"ok": True, "output": run.stdout.strip()}
    parsed["sandbox_name"] = sandbox_name
    parsed["error"] = None
    return parsed


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
            run = await run_capture(
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
                timeout_seconds=timeout_seconds + 5,
            )
            if run.timed_out:
                effective_policy = f"openclaw exec-policy show timed out after {timeout_seconds}s"
            else:
                effective_policy = run.stdout or run.stderr

    return {
        "approvals_path": approvals_path if os.path.exists(approvals_path) else None,
        "snapshot": snapshot,
        "error": error,
        "sandbox_name": sandbox_name,
        "effective_policy": effective_policy,
    }
