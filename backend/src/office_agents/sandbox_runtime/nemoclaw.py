"""Helpers for inspecting NemoClaw/OpenShell state from the demo backend."""

from __future__ import annotations

import base64
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
_SAFE_CHUNK_ID = re.compile(r"^[A-Za-z0-9_.:-]+$")
_ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\a]*(?:\a|\x1b\\)")
_NETWORK_RULE_STATUSES = {"pending", "approved", "rejected", "all"}
_WEB_SEARCH_PROVIDERS = {
    "auto",
    "brave",
    "duckduckgo",
    "exa",
    "firecrawl",
    "gemini",
    "grok",
    "kimi",
    "minimax",
    "ollama",
    "perplexity",
    "searxng",
    "tavily",
}
_WEB_SEARCH_PROVIDER_LABELS: dict[str, str] = {
    "auto": "Auto",
    "duckduckgo": "DuckDuckGo",
    "ollama": "Ollama Web Search",
    "brave": "Brave Search",
    "tavily": "Tavily",
    "perplexity": "Perplexity",
    "exa": "Exa",
    "firecrawl": "Firecrawl",
    "searxng": "SearXNG",
    "gemini": "Gemini",
    "grok": "Grok",
    "kimi": "Kimi",
    "minimax": "MiniMax",
}
_WEB_SEARCH_CREDENTIALS: dict[str, list[str]] = {
    "brave": ["BRAVE_API_KEY"],
    "tavily": ["TAVILY_API_KEY"],
    "perplexity": ["PERPLEXITY_API_KEY"],
    "exa": ["EXA_API_KEY"],
    "firecrawl": ["FIRECRAWL_API_KEY"],
    "gemini": ["GEMINI_API_KEY"],
    "grok": ["XAI_API_KEY"],
    "kimi": ["KIMI_API_KEY"],
    "minimax": ["MINIMAX_API_KEY"],
    # Ollama can be local+signed-in or cloud API-key backed. The UI treats
    # this as a setup note rather than a hard credential requirement.
    "ollama": ["OLLAMA_API_KEY or ollama signin"],
}
_ARTIFACT_TEXT_EXTENSIONS = {
    ".css", ".csv", ".html", ".htm", ".js", ".json", ".log", ".md",
    ".svg", ".txt", ".ts", ".tsx", ".xml", ".yaml", ".yml",
}


def _which(command: str) -> str | None:
    """Locate *command* on PATH, falling back to a configurable list of bin
    directories. Defaults come from ``settings.extra_bin_paths``; override via
    ``OFFICE_AGENTS_EXTRA_BIN_PATHS``.
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


async def create_nemoclaw_sandbox(
    sandbox_name: str,
    *,
    timeout_seconds: int = 600,
) -> dict[str, Any]:
    """Provision a live NemoClaw/OpenShell sandbox on the backend host."""
    if not _SAFE_NAME.match(sandbox_name):
        return {"ok": False, "error": "Invalid sandbox name"}

    nemoclaw_cmd = _which("nemoclaw")
    if not nemoclaw_cmd:
        return {"ok": False, "error": "NemoClaw CLI was not found on PATH."}

    provider = (settings.nemoclaw_provider or "custom").strip()
    model = (settings.nemoclaw_model or settings.llm_model).strip()
    endpoint_url = (settings.nemoclaw_endpoint_url or settings.llm_base_url).strip()
    api_key = settings.nemoclaw_api_key or settings.llm_api_key or "dummy"

    # NemoClaw's onboard provider selector uses menu keys, not the persisted
    # OpenShell provider name. The live route reports "compatible-endpoint",
    # while non-interactive onboard expects "custom" for that same provider.
    # On demo hosts, env can drift to "ollama" even after the gateway route is
    # switched to compatible-endpoint; prefer the active route when it is clear.
    onboard_provider = provider
    active_route = await _get_active_inference_route(nemoclaw_cmd)
    if active_route.get("provider") == "compatible-endpoint":
        onboard_provider = "custom"
        if isinstance(active_route.get("model"), str) and active_route["model"].strip():
            model = active_route["model"].strip()
    elif onboard_provider == "compatible-endpoint":
        onboard_provider = "custom"

    env = os.environ.copy()
    env.update({
        "NEMOCLAW_PROVIDER": onboard_provider,
        "NEMOCLAW_MODEL": model,
        "NEMOCLAW_POLICY_TIER": "balanced",
        "NEMOCLAW_YES": "1",
        "NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE": "1",
        "NEMOCLAW_PREFERRED_API": "openai-completions",
        "NEMOCLAW_AGENT_TIMEOUT": str(settings.openclaw_turn_timeout_seconds),
    })
    if onboard_provider == "custom" or settings.nemoclaw_endpoint_url:
        env["NEMOCLAW_ENDPOINT_URL"] = endpoint_url
    if onboard_provider == "custom":
        env["COMPATIBLE_API_KEY"] = api_key

    run = await run_capture(
        nemoclaw_cmd,
        "onboard",
        "--non-interactive",
        "--yes",
        "--yes-i-accept-third-party-software",
        "--name",
        sandbox_name,
        "--no-gpu",
        "--no-sandbox-gpu",
        timeout_seconds=timeout_seconds,
        env=env,
    )
    output = _strip_ansi("\n".join(part for part in (run.stdout, run.stderr) if part)).strip()
    if run.timed_out:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "output": output,
            "error": f"nemoclaw onboard timed out after {timeout_seconds}s",
        }

    output = _strip_ansi("\n".join(part for part in (run.stdout, run.stderr) if part)).strip()
    if run.returncode == 0:
        policy_result = await set_policy_preset(
            sandbox_name,
            "local-inference",
            enabled=True,
            dry_run=False,
        )
        if policy_result.get("ok"):
            policy_output = str(policy_result.get("output") or "").strip()
            output = "\n".join(
                part for part in (output, f"[post-onboard] local-inference enabled\n{policy_output}")
                if part
            )
        else:
            policy_error = str(policy_result.get("error") or "local-inference policy failed").strip()
            output = "\n".join(
                part for part in (output, f"[post-onboard warning] {policy_error}") if part
            )

    return {
        "ok": run.returncode == 0,
        "sandbox_name": sandbox_name,
        "output": output,
        "error": None if run.returncode == 0 else output,
    }


async def _get_active_inference_route(nemoclaw_cmd: str) -> dict[str, Any]:
    """Best-effort read of the active NemoClaw inference route."""
    run = await run_capture(
        nemoclaw_cmd,
        "inference",
        "get",
        "--json",
        timeout_seconds=8,
    )
    if run.returncode != 0 or not run.stdout.strip():
        return {}
    try:
        data = json.loads(run.stdout)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


async def get_policy_presets(
    sandbox_name: str,
    timeout_seconds: int = 12,
    *,
    include_checks: bool = False,
) -> dict[str, Any]:
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
    policies = _parse_policy_list(output)
    credential_checks = (
        await get_policy_credential_checks(sandbox_name, policies)
        if include_checks
        else []
    )

    return {
        "sandbox_name": sandbox_name,
        "policies": policies,
        "credential_checks": credential_checks,
        "raw": output,
        "error": None if run.returncode == 0 else output,
    }


def _parse_policy_list(output: str) -> list[dict[str, Any]]:
    policies: list[dict[str, Any]] = []
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
    return policies


def _strip_ansi(value: str) -> str:
    return _ANSI_RE.sub("", value).replace("\r\n", "\n").replace("\r", "\n")


def _parse_int(value: str) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_network_rule_list(
    output: str,
    *,
    sandbox_name: str | None = None,
    status_filter: str = "all",
) -> dict[str, Any]:
    """Parse ``openshell rule get`` text output into stable UI data.

    OpenShell currently prints a human-oriented, ANSI-colored table. Keep this
    parser intentionally tolerant so minor formatting shifts do not hide rules
    from the UI.
    """
    clean = _strip_ansi(output)
    version: int | None = None
    expected_count: int | None = None
    rules: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    header_match = re.search(
        r"Network Rules:\s*(?:\(version\s+(\d+),\s+(\d+)\s+chunks?\))?",
        clean,
        re.IGNORECASE,
    )
    if header_match:
        version = _parse_int(header_match.group(1) or "")
        expected_count = _parse_int(header_match.group(2) or "")

    def finish_current() -> None:
        nonlocal current
        if not current:
            return
        if current.get("id"):
            rules.append(current)
        current = None

    for raw_line in clean.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        label_match = re.match(r"^([A-Za-z][A-Za-z ]+):\s*(.*)$", line)
        if not label_match:
            continue

        label = label_match.group(1).strip().lower()
        value = label_match.group(2).strip()

        if label == "chunk":
            finish_current()
            current = {
                "id": value,
                "status": "unknown",
                "rule_name": "",
                "binary": "",
                "confidence": None,
                "rationale": "",
                "security": "",
                "security_flags": [],
                "endpoints": [],
                "endpoints_raw": "",
                "binaries": [],
                "binaries_raw": "",
                "hit_count": None,
                "first_seen": None,
                "last_seen": None,
            }
            continue

        if current is None:
            continue

        if label == "status":
            current["status"] = value.lower()
        elif label == "rule":
            current["rule_name"] = value
        elif label == "binary":
            current["binary"] = value
        elif label == "confidence":
            pct = re.search(r"(\d+)", value)
            current["confidence"] = _parse_int(pct.group(1)) if pct else None
        elif label == "rationale":
            current["rationale"] = value
        elif label == "security":
            current["security"] = value
            flags: list[str] = []
            lower = value.lower()
            if "internal" in lower or "private" in lower:
                flags.append("private-ip")
            if "ssrf" in lower:
                flags.append("ssrf-override")
            current["security_flags"] = flags
        elif label == "endpoints":
            current["endpoints_raw"] = value
            current["endpoints"] = [part.strip() for part in value.split(",") if part.strip()]
        elif label == "binaries":
            current["binaries_raw"] = value
            current["binaries"] = [part.strip() for part in value.split(",") if part.strip()]
        elif label == "hits":
            hit_match = re.match(
                r"(\d+)(?:\s+\(first seen\s+([^,]+),\s+last seen\s+([^)]+)\))?",
                value,
                re.IGNORECASE,
            )
            if hit_match:
                current["hit_count"] = _parse_int(hit_match.group(1))
                current["first_seen"] = hit_match.group(2)
                current["last_seen"] = hit_match.group(3)

    finish_current()

    counts = {
        "pending": sum(1 for rule in rules if rule.get("status") == "pending"),
        "approved": sum(1 for rule in rules if rule.get("status") == "approved"),
        "rejected": sum(1 for rule in rules if rule.get("status") == "rejected"),
    }

    return {
        "sandbox_name": sandbox_name,
        "status_filter": status_filter,
        "version": version,
        "expected_count": expected_count,
        "rules": rules,
        "counts": counts,
        "raw": clean,
        "error": None,
    }


async def get_network_rules(
    sandbox_name: str,
    *,
    status: str = "all",
    timeout_seconds: int = 20,
) -> dict[str, Any]:
    """Return OpenShell network-rule recommendations for a sandbox."""
    if not _SAFE_NAME.match(sandbox_name):
        return {"error": "Invalid sandbox name", "rules": []}

    status_filter = status.lower().strip() if status else "all"
    if status_filter not in _NETWORK_RULE_STATUSES:
        return {"error": "Invalid network rule status", "rules": []}

    openshell_cmd = _which("openshell")
    if not openshell_cmd:
        return {"error": "OpenShell CLI was not found on PATH.", "rules": []}

    cmd = [openshell_cmd, "rule", "get"]
    if status_filter != "all":
        cmd.extend(["--status", status_filter])
    cmd.append(sandbox_name)

    run = await run_capture(*cmd, timeout_seconds=timeout_seconds)
    output = run.stdout or run.stderr
    if run.timed_out:
        return {
            "sandbox_name": sandbox_name,
            "status_filter": status_filter,
            "rules": [],
            "counts": {"pending": 0, "approved": 0, "rejected": 0},
            "raw": _strip_ansi(output),
            "error": f"openshell rule get timed out after {timeout_seconds}s",
        }

    parsed = _parse_network_rule_list(
        output,
        sandbox_name=sandbox_name,
        status_filter=status_filter,
    )
    parsed["ok"] = run.returncode == 0
    parsed["error"] = None if run.returncode == 0 else _strip_ansi(output).strip()
    return parsed


async def probe_sandbox_inference(
    sandbox_name: str,
    *,
    timeout_seconds: int = 20,
) -> dict[str, Any]:
    """Check whether an OpenShell sandbox can reach its inference route."""
    if not _SAFE_NAME.match(sandbox_name):
        return {"ok": False, "error": "Invalid sandbox name"}

    openshell_cmd = _which("openshell")
    if not openshell_cmd:
        return {"ok": False, "error": "OpenShell CLI was not found on PATH."}

    run = await run_capture(
        openshell_cmd,
        "sandbox",
        "exec",
        "--name",
        sandbox_name,
        "--timeout",
        str(timeout_seconds),
        "--no-tty",
        "--",
        "curl",
        "-sk",
        "--connect-timeout",
        "5",
        "--max-time",
        str(max(6, timeout_seconds - 4)),
        "https://inference.local/v1/models",
        timeout_seconds=timeout_seconds + 5,
    )
    output = _strip_ansi(run.stdout or run.stderr).strip()
    if run.timed_out:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "error": f"inference probe timed out after {timeout_seconds}s",
            "output": output[:1000],
        }
    if run.returncode != 0:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "error": output or f"curl exited with code {run.returncode}",
            "output": output[:1000],
        }
    try:
        parsed = json.loads(output)
    except json.JSONDecodeError:
        parsed = None
    model_count = 0
    if isinstance(parsed, dict):
        models = parsed.get("models") or parsed.get("data") or []
        if isinstance(models, list):
            model_count = len(models)
    return {
        "ok": True,
        "sandbox_name": sandbox_name,
        "model_count": model_count,
        "output": output[:1000],
        "error": None,
    }


async def list_task_artifacts(
    sandbox_name: str,
    run_id: str,
    *,
    timeout_seconds: int = 20,
) -> dict[str, Any]:
    """List small text/web artifacts under /sandbox/runs/<run_id>."""
    if not _SAFE_NAME.match(sandbox_name) or not _SAFE_CHUNK_ID.match(run_id):
        return {"ok": False, "error": "Invalid sandbox or run id", "files": []}

    openshell_cmd = _which("openshell")
    if not openshell_cmd:
        return {"ok": False, "error": "OpenShell CLI was not found on PATH.", "files": []}

    script = """
import json
import os
import sys

run_id = sys.argv[1]
root = os.path.realpath('/sandbox/runs/' + run_id)
allowed = set(sys.argv[2].split(','))
items = []
if os.path.isdir(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith('.')]
        for name in filenames:
            if name.startswith('.'):
                continue
            path = os.path.realpath(os.path.join(dirpath, name))
            if not path.startswith(root + os.sep):
                continue
            ext = os.path.splitext(name)[1].lower()
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            if size > 2_000_000:
                continue
            rel = os.path.relpath(path, root)
            items.append({
                'path': rel,
                'size': size,
                'kind': 'html' if ext in {'.html', '.htm'} else 'text',
                'previewable': ext in allowed,
            })
print(json.dumps({'files': sorted(items, key=lambda item: item['path'])[:100]}))
""".strip()
    encoded_script = base64.b64encode(script.encode("utf-8")).decode("ascii")
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
        "--no-tty",
        "--",
        "python3",
        "-c",
        "import base64,sys; sys.argv=sys.argv[1:]; exec(base64.b64decode(sys.argv[0]))",
        encoded_script,
        run_id,
        ",".join(sorted(_ARTIFACT_TEXT_EXTENSIONS)),
        timeout_seconds=timeout_seconds + 5,
    )
    output = _strip_ansi(run.stdout or run.stderr).strip()
    if run.timed_out:
        return {"ok": False, "error": f"artifact list timed out after {timeout_seconds}s", "files": []}
    if run.returncode != 0:
        return {"ok": False, "error": output[:1000] or "artifact list failed", "files": []}
    try:
        parsed = json.loads(output or "{}")
    except json.JSONDecodeError:
        return {"ok": False, "error": "artifact list returned invalid JSON", "raw": output[:1000], "files": []}
    files = parsed.get("files") if isinstance(parsed.get("files"), list) else []
    return {"ok": True, "sandbox_name": sandbox_name, "run_id": run_id, "files": files, "error": None}


def _artifact_path_is_safe(path: str) -> bool:
    if not path or path.startswith("/") or "\x00" in path:
        return False
    parts = path.split("/")
    return all(part not in {"", ".", ".."} for part in parts)


async def read_task_artifact(
    sandbox_name: str,
    run_id: str,
    artifact_path: str,
    *,
    timeout_seconds: int = 20,
) -> dict[str, Any]:
    """Read a small artifact from /sandbox/runs/<run_id> as base64."""
    if (
        not _SAFE_NAME.match(sandbox_name)
        or not _SAFE_CHUNK_ID.match(run_id)
        or not _artifact_path_is_safe(artifact_path)
    ):
        return {"ok": False, "error": "Invalid sandbox, run id, or artifact path"}

    openshell_cmd = _which("openshell")
    if not openshell_cmd:
        return {"ok": False, "error": "OpenShell CLI was not found on PATH."}

    script = """
import base64
import json
import os
import sys

run_id = sys.argv[1]
rel = sys.argv[2]
root = os.path.realpath('/sandbox/runs/' + run_id)
path = os.path.realpath(os.path.join(root, rel))
ok = path.startswith(root + os.sep) and os.path.isfile(path) and os.path.getsize(path) <= 2_000_000
if not ok:
    print(json.dumps({'ok': False, 'error': 'artifact not found or too large'}))
    sys.exit(0)
with open(path, 'rb') as handle:
    data = handle.read()
print(json.dumps({'ok': True, 'path': rel, 'size': len(data), 'b64': base64.b64encode(data).decode('ascii')}))
""".strip()
    encoded_script = base64.b64encode(script.encode("utf-8")).decode("ascii")
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
        "--no-tty",
        "--",
        "python3",
        "-c",
        "import base64,sys; sys.argv=sys.argv[1:]; exec(base64.b64decode(sys.argv[0]))",
        encoded_script,
        run_id,
        artifact_path,
        timeout_seconds=timeout_seconds + 5,
    )
    output = _strip_ansi(run.stdout or run.stderr).strip()
    if run.timed_out:
        return {"ok": False, "error": f"artifact read timed out after {timeout_seconds}s"}
    if run.returncode != 0:
        return {"ok": False, "error": output[:1000] or "artifact read failed"}
    try:
        parsed = json.loads(output or "{}")
    except json.JSONDecodeError:
        return {"ok": False, "error": "artifact read returned invalid JSON", "raw": output[:1000]}
    return parsed if isinstance(parsed, dict) else {"ok": False, "error": "artifact read returned invalid payload"}


async def decide_network_rule(
    sandbox_name: str,
    chunk_id: str,
    *,
    decision: str,
    timeout_seconds: int = 30,
) -> dict[str, Any]:
    """Approve or reject/revoke one OpenShell network-rule recommendation."""
    if not _SAFE_NAME.match(sandbox_name):
        return {"ok": False, "error": "Invalid sandbox name"}
    if not _SAFE_CHUNK_ID.match(chunk_id):
        return {"ok": False, "error": "Invalid network rule chunk id"}
    if decision not in {"approve", "reject"}:
        return {"ok": False, "error": "Invalid network rule decision"}

    openshell_cmd = _which("openshell")
    if not openshell_cmd:
        return {"ok": False, "error": "OpenShell CLI was not found on PATH."}

    run = await run_capture(
        openshell_cmd,
        "rule",
        decision,
        sandbox_name,
        "--chunk-id",
        chunk_id,
        timeout_seconds=timeout_seconds,
    )
    output = _strip_ansi(run.stdout or run.stderr).strip()
    if run.timed_out:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "chunk_id": chunk_id,
            "decision": decision,
            "output": output,
            "error": f"openshell rule {decision} timed out after {timeout_seconds}s",
        }

    return {
        "ok": run.returncode == 0,
        "sandbox_name": sandbox_name,
        "chunk_id": chunk_id,
        "decision": decision,
        "output": output,
        "error": None if run.returncode == 0 else output,
    }


async def approve_all_network_rules(
    sandbox_name: str,
    *,
    include_security_flagged: bool = False,
    timeout_seconds: int = 45,
) -> dict[str, Any]:
    """Approve pending OpenShell network rules for a sandbox."""
    if not _SAFE_NAME.match(sandbox_name):
        return {"ok": False, "error": "Invalid sandbox name"}

    openshell_cmd = _which("openshell")
    if not openshell_cmd:
        return {"ok": False, "error": "OpenShell CLI was not found on PATH."}

    cmd = [openshell_cmd, "rule", "approve-all", sandbox_name]
    if include_security_flagged:
        cmd.append("--include-security-flagged")

    run = await run_capture(*cmd, timeout_seconds=timeout_seconds)
    output = _strip_ansi(run.stdout or run.stderr).strip()
    if run.timed_out:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "include_security_flagged": include_security_flagged,
            "output": output,
            "error": f"openshell rule approve-all timed out after {timeout_seconds}s",
        }

    return {
        "ok": run.returncode == 0,
        "sandbox_name": sandbox_name,
        "include_security_flagged": include_security_flagged,
        "output": output,
        "error": None if run.returncode == 0 else output,
    }


async def clear_pending_network_rules(
    sandbox_name: str,
    *,
    timeout_seconds: int = 30,
) -> dict[str, Any]:
    """Clear pending OpenShell network-rule recommendations."""
    if not _SAFE_NAME.match(sandbox_name):
        return {"ok": False, "error": "Invalid sandbox name"}

    openshell_cmd = _which("openshell")
    if not openshell_cmd:
        return {"ok": False, "error": "OpenShell CLI was not found on PATH."}

    run = await run_capture(
        openshell_cmd,
        "rule",
        "clear",
        sandbox_name,
        timeout_seconds=timeout_seconds,
    )
    output = _strip_ansi(run.stdout or run.stderr).strip()
    if run.timed_out:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "output": output,
            "error": f"openshell rule clear timed out after {timeout_seconds}s",
        }

    return {
        "ok": run.returncode == 0,
        "sandbox_name": sandbox_name,
        "output": output,
        "error": None if run.returncode == 0 else output,
    }


def _clean_config_value(value: str) -> str | None:
    text = _strip_ansi(str(value or "")).strip()
    if not text or text.lower() in {"undefined", "null", "none"}:
        return None
    if (text.startswith('"') and text.endswith('"')) or (
        text.startswith("'") and text.endswith("'")
    ):
        text = text[1:-1].strip()
    return text or None


def _web_search_provider_meta(provider: str) -> dict[str, Any]:
    normalized = provider if provider in _WEB_SEARCH_PROVIDERS else "auto"
    return {
        "provider": normalized,
        "label": _WEB_SEARCH_PROVIDER_LABELS.get(normalized, normalized),
        "credentials": _WEB_SEARCH_CREDENTIALS.get(normalized, []),
        "keyless": normalized in {"auto", "duckduckgo", "searxng"},
    }


async def get_openclaw_web_search_provider(
    sandbox_name: str,
    *,
    timeout_seconds: int = 10,
) -> dict[str, Any]:
    """Read OpenClaw's sandbox-local web_search provider configuration."""
    if not _SAFE_NAME.match(sandbox_name):
        return {"ok": False, "sandbox_name": sandbox_name, "error": "Invalid sandbox name"}

    openshell_cmd = _which("openshell")
    if not openshell_cmd:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "error": "OpenShell CLI was not found on PATH.",
            "supported_providers": sorted(_WEB_SEARCH_PROVIDERS),
        }

    script = (
        'set +e; '
        'provider="$(openclaw config get tools.web.search.provider 2>/tmp/openclaw-web-provider.err)"; pc=$?; '
        'ollama_base="$(openclaw config get models.providers.ollama.baseUrl 2>/tmp/openclaw-web-ollama-base.err)"; bc=$?; '
        'plugin_base="$(openclaw config get plugins.entries.ollama.config.webSearch.baseUrl 2>/tmp/openclaw-web-ollama-plugin-base.err)"; pbc=$?; '
        'provider_err="$(cat /tmp/openclaw-web-provider.err 2>/dev/null)"; '
        'python3 -c \'import json,sys; '
        'print(json.dumps({"provider":sys.argv[1],"provider_status":sys.argv[2],'
        '"ollama_base_url":sys.argv[3],"ollama_base_status":sys.argv[4],'
        '"plugin_ollama_base_url":sys.argv[5],"plugin_ollama_base_status":sys.argv[6],'
        '"provider_error":sys.argv[7]}))\' '
        '"$provider" "$pc" "$ollama_base" "$bc" "$plugin_base" "$pbc" "$provider_err"'
    )
    run = await run_capture(
        openshell_cmd,
        "sandbox",
        "exec",
        "--name",
        sandbox_name,
        "--timeout",
        str(timeout_seconds),
        "--",
        "sh",
        "-lc",
        script,
        timeout_seconds=timeout_seconds + 5,
    )
    output = _strip_ansi(run.stdout or run.stderr).strip()
    if run.timed_out:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "error": f"OpenClaw web-search config read timed out after {timeout_seconds}s",
            "supported_providers": sorted(_WEB_SEARCH_PROVIDERS),
        }
    if run.returncode != 0:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "error": output or f"OpenShell exited with code {run.returncode}",
            "supported_providers": sorted(_WEB_SEARCH_PROVIDERS),
        }

    try:
        parsed = json.loads(output)
    except json.JSONDecodeError:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "error": "OpenClaw web-search config returned invalid JSON.",
            "raw": output[:1200],
            "supported_providers": sorted(_WEB_SEARCH_PROVIDERS),
        }

    raw_provider = _clean_config_value(str(parsed.get("provider") or "")) or "auto"
    provider = raw_provider if raw_provider in _WEB_SEARCH_PROVIDERS else "auto"
    meta = _web_search_provider_meta(provider)
    return {
        "ok": True,
        "sandbox_name": sandbox_name,
        "provider": provider,
        "configured_provider": None if provider == "auto" else provider,
        "raw_provider": raw_provider,
        "label": meta["label"],
        "credentials": meta["credentials"],
        "keyless": meta["keyless"],
        "ollama_base_url": _clean_config_value(str(parsed.get("ollama_base_url") or "")),
        "plugin_ollama_base_url": _clean_config_value(
            str(parsed.get("plugin_ollama_base_url") or "")
        ),
        "supported_providers": sorted(_WEB_SEARCH_PROVIDERS),
        "recommended_providers": ["duckduckgo", "ollama", "brave", "auto"],
        "error": None,
    }


async def set_openclaw_web_search_provider(
    sandbox_name: str,
    provider: str,
    *,
    ollama_base_url: str | None = None,
    timeout_seconds: int = 20,
) -> dict[str, Any]:
    """Set OpenClaw's sandbox-local web_search provider.

    This intentionally configures provider metadata only. Secret API keys stay
    out of the app and should be supplied through OpenClaw/NemoClaw host setup.
    """
    if not _SAFE_NAME.match(sandbox_name):
        return {"ok": False, "sandbox_name": sandbox_name, "error": "Invalid sandbox name"}

    normalized = (provider or "").strip().lower()
    if normalized not in _WEB_SEARCH_PROVIDERS:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "error": f"Unsupported web search provider: {provider}",
            "supported_providers": sorted(_WEB_SEARCH_PROVIDERS),
        }

    base_url = (ollama_base_url or "").strip()
    if base_url and not re.match(r"^https?://[A-Za-z0-9_.:/-]+$", base_url):
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "error": "Ollama base URL must be http(s) and contain only URL-safe characters.",
        }

    openshell_cmd = _which("openshell")
    if not openshell_cmd:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "error": "OpenShell CLI was not found on PATH.",
            "supported_providers": sorted(_WEB_SEARCH_PROVIDERS),
        }

    provider_cmd = (
        'openclaw config unset tools.web.search.provider'
        if normalized == "auto"
        else 'openclaw config set tools.web.search.provider "$1"'
    )
    ollama_cmd = (
        'if [ "$2" ]; then '
        'openclaw config set models.providers.ollama.baseUrl "$2"; '
        'openclaw config set plugins.entries.ollama.config.webSearch.baseUrl "$2"; '
        'fi'
        if normalized == "ollama"
        else ':'
    )
    script = (
        'set -e; provider="$1"; base_url="$2"; '
        f'{provider_cmd}; '
        f'{ollama_cmd}; '
        'openclaw config validate >/tmp/openclaw-web-validate.log 2>&1 || '
        '{ cat /tmp/openclaw-web-validate.log; exit 1; }; '
        'echo "web_search provider updated to ${provider:-auto}"; '
        'if [ "$base_url" ]; then echo "ollama baseUrl set to $base_url"; fi'
    )
    run = await run_capture(
        openshell_cmd,
        "sandbox",
        "exec",
        "--name",
        sandbox_name,
        "--timeout",
        str(timeout_seconds),
        "--",
        "sh",
        "-lc",
        script,
        "openclaw-web-search-provider",
        "" if normalized == "auto" else normalized,
        base_url,
        timeout_seconds=timeout_seconds + 5,
    )
    output = _strip_ansi(run.stdout or run.stderr).strip()
    if run.timed_out:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "provider": normalized,
            "output": output,
            "error": f"OpenClaw web-search config update timed out after {timeout_seconds}s",
        }
    if run.returncode != 0:
        return {
            "ok": False,
            "sandbox_name": sandbox_name,
            "provider": normalized,
            "output": output,
            "error": output or f"OpenShell exited with code {run.returncode}",
        }

    status = await get_openclaw_web_search_provider(sandbox_name)
    return {
        **status,
        "ok": bool(status.get("ok")),
        "output": output,
        "provider": normalized if normalized != "auto" else str(status.get("provider") or "auto"),
    }


_POLICY_CREDENTIALS: dict[str, list[str]] = {
    "brave": ["BRAVE_API_KEY"],
}


async def get_policy_credential_checks(
    sandbox_name: str,
    policies: list[dict[str, Any]],
    timeout_seconds: int = 8,
) -> list[dict[str, Any]]:
    """Return presence-only checks for credentials required by enabled policies."""
    if not _SAFE_NAME.match(sandbox_name):
        return []

    policy_by_name = {
        str(policy.get("name")): bool(policy.get("enabled"))
        for policy in policies
        if isinstance(policy.get("name"), str)
    }
    env_names = sorted({
        env_name
        for policy_name in policy_by_name
        for env_name in _POLICY_CREDENTIALS.get(policy_name, [])
    })
    if not env_names:
        return []

    openshell_cmd = _which("openshell")
    if not openshell_cmd:
        return [
            {
                "policy": policy_name,
                "name": env_name,
                "required": enabled,
                "present": None,
                "status": "unknown",
                "message": "OpenShell CLI was not found on PATH.",
            }
            for policy_name, enabled in policy_by_name.items()
            for env_name in _POLICY_CREDENTIALS.get(policy_name, [])
        ]

    py = (
        "import json,os,sys;"
        "names=sys.argv[1:];"
        "print(json.dumps({name: bool(os.environ.get(name)) for name in names}))"
    )
    run = await run_capture(
        openshell_cmd,
        "sandbox",
        "exec",
        "--name",
        sandbox_name,
        "--timeout",
        str(timeout_seconds),
        "--",
        "python3",
        "-c",
        py,
        *env_names,
        timeout_seconds=timeout_seconds + 5,
    )

    present_by_name: dict[str, bool] = {}
    error: str | None = None
    if run.timed_out:
        error = f"credential check timed out after {timeout_seconds}s"
    elif run.returncode != 0:
        error = run.stderr or run.stdout or f"openshell exited with code {run.returncode}"
    else:
        try:
            parsed = json.loads(run.stdout)
            if isinstance(parsed, dict):
                present_by_name = {str(k): bool(v) for k, v in parsed.items()}
        except json.JSONDecodeError:
            error = "credential check returned invalid JSON"

    checks: list[dict[str, Any]] = []
    for policy_name, enabled in policy_by_name.items():
        for env_name in _POLICY_CREDENTIALS.get(policy_name, []):
            present = present_by_name.get(env_name) if error is None else None
            if error:
                status = "unknown"
                message = error
            elif present:
                status = "ok"
                message = f"{env_name} is present."
            elif enabled:
                status = "missing"
                message = f"{policy_name} is enabled, but {env_name} is missing."
            else:
                status = "not_required"
                message = f"{policy_name} is disabled."
            checks.append({
                "policy": policy_name,
                "name": env_name,
                "required": enabled,
                "present": present,
                "status": status,
                "message": message,
            })
    return checks


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
        "snapshot": _redact_sensitive(snapshot),
        "error": error,
        "sandbox_name": sandbox_name,
        "effective_policy": effective_policy,
        "summary": _approval_summary(effective_policy, snapshot),
    }


_SENSITIVE_KEY_RE = re.compile(r"(token|secret|password|api[_-]?key|auth|credential)", re.IGNORECASE)


def _redact_sensitive(value: Any) -> Any:
    """Redact secrets from approval snapshots before returning them to the UI."""
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            if _SENSITIVE_KEY_RE.search(str(key)):
                redacted[key] = "<redacted>"
            else:
                redacted[key] = _redact_sensitive(item)
        return redacted
    if isinstance(value, list):
        return [_redact_sensitive(item) for item in value]
    return value


def _approval_summary(effective_policy: str, snapshot: Any) -> dict[str, Any]:
    ask = None
    security = None
    ask_match = re.search(r"ask=([a-z0-9_-]+)", effective_policy or "", re.IGNORECASE)
    security_match = re.search(r"security=([a-z0-9_-]+)", effective_policy or "", re.IGNORECASE)
    if ask_match:
        ask = ask_match.group(1)
    if security_match:
        security = security_match.group(1)
    return {
        "ask": ask or "unknown",
        "security": security or "unknown",
        "has_snapshot": isinstance(snapshot, dict),
    }
