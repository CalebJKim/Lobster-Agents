"""OpenClaw subprocess wrapper — Spark-only.

Every code action runs inside a NemoClaw sandbox via `openshell sandbox exec`.
There is no host-local fallback: this backend is meant to live on the DGX
Spark where `openshell` and `nemoclaw` are installed. If those CLIs are
missing the call fails fast with a clear error so the UI can surface it.

The previous version had a host-local OpenClaw fallback path that masked
"missing CLI" errors with subtle subprocess failures on developer Macs. That
code is gone.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 120
DEFAULT_SANDBOX_WORKDIR = "/sandbox/workspaces"


def _which_openshell() -> str | None:
    """Locate openshell on PATH; this backend is meant for the Spark host."""
    return shutil.which("openshell")


async def run_openclaw(
    task: str,
    *,
    claw_id: str = "main",
    sandbox_name: str = "nemoclaw-main",
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    # Kept for backwards-compat with older callers; ignored. All runs go
    # through openshell now.
    require_sandbox: bool = True,
    working_dir: str | None = None,
    # Per-lobster context — splice into the OpenClaw prompt so the agent
    # acts in character with its specialties instead of as a generic worker.
    display_name: str | None = None,
    role_label: str | None = None,
    personality: str | None = None,
    tools: list[str] | None = None,
    # Coordinated mode — prior teammates' outputs so this lobster can build
    # on what came before, not just produce a parallel isolated turn.
    prior_turns: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Run one OpenClaw agent turn inside a NemoClaw sandbox.

    Returns a result dict shaped like the rest of the codebase expects:
        {success, output, files_created, claw_id, sandbox_name,
         nemoclaw_available, execution_mode, error?}
    Never raises — failures land in the result dict so the UI can show them.
    """
    del require_sandbox, working_dir  # accepted but no longer meaningful

    openshell = _which_openshell()
    if not openshell:
        msg = (
            "openshell CLI not found on PATH. "
            "This backend must run on the NemoClaw host (DGX Spark)."
        )
        logger.error(msg)
        return _failure(claw_id, sandbox_name, msg, mode="cli_missing")

    sandbox_workdir = f"{DEFAULT_SANDBOX_WORKDIR}/{claw_id}"
    message = _single_line(
        _format_openclaw_message(
            task,
            claw_id,
            sandbox_name,
            sandbox_workdir,
            display_name=display_name,
            role_label=role_label,
            personality=personality,
            tools=tools or [],
            prior_turns=prior_turns or [],
        )
    )

    proc: asyncio.subprocess.Process | None = None
    try:
        proc = await asyncio.create_subprocess_exec(
            openshell,
            "sandbox", "exec",
            "--name", sandbox_name,
            "--workdir", "/sandbox",
            "--timeout", str(timeout_seconds + 30),
            "--",
            "sh", "-lc",
            (
                'mkdir -p "$1" && cd "$1" && exec openclaw agent '
                '--agent "$2" --json --timeout "$3" --message "$4"'
            ),
            "openclaw-runner",
            sandbox_workdir,
            claw_id,
            str(timeout_seconds),
            message,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(), timeout=timeout_seconds + 45
        )
    except asyncio.TimeoutError:
        logger.error("OpenClaw run timed out after %ss in sandbox=%s", timeout_seconds, sandbox_name)
        await _terminate(proc, "OpenClaw run timed out")
        return _failure(
            claw_id, sandbox_name,
            f"OpenClaw timed out after {timeout_seconds}s.",
            mode="timeout",
        )
    except asyncio.CancelledError:
        await _terminate(proc, "OpenClaw run cancelled")
        raise
    except FileNotFoundError:
        return _failure(claw_id, sandbox_name, "openshell binary disappeared between PATH lookup and exec.", mode="cli_missing")
    except Exception as exc:
        logger.exception("Unexpected error running OpenClaw inside sandbox %s", sandbox_name)
        return _failure(claw_id, sandbox_name, f"{type(exc).__name__}: {exc}", mode="unexpected")

    stdout = stdout_bytes.decode("utf-8", errors="replace")
    stderr = stderr_bytes.decode("utf-8", errors="replace")

    if proc.returncode != 0:
        logger.warning(
            "OpenClaw exited %s in sandbox=%s: %s",
            proc.returncode, sandbox_name, (stderr or stdout)[:500],
        )
        return _failure(
            claw_id, sandbox_name,
            stderr or stdout or f"openshell exited with code {proc.returncode}",
            mode="exec_failed",
        )

    output_text = _extract_openclaw_output(stdout)
    return {
        "success": True,
        "output": output_text,
        "files_created": [],
        "claw_id": claw_id,
        "sandbox_name": sandbox_name,
        "nemoclaw_available": True,
        "execution_mode": "openshell_sandbox",
    }


async def ensure_openclaw_agent(
    *,
    sandbox_name: str,
    claw_id: str,
    display_name: str,
    model: str,
    skills: list[str] | None = None,
    timeout_seconds: int = 120,
) -> dict[str, Any]:
    """Make sure an OpenClaw agent profile exists inside the sandbox.

    If ``skills`` is provided, installs each ClawHub slug via
    ``openclaw skills install <slug> --agent <claw_id>``. Already-installed
    skills are skipped via ``openclaw skills check`` before the install pass
    so re-running this on existing agents is cheap.
    """

    openshell = _which_openshell()
    if not openshell:
        return _failure(
            claw_id, sandbox_name,
            "openshell CLI not found on PATH. Run the backend on the Spark host.",
            mode="cli_missing",
        )

    # Sanitize skill slugs so we don't quote-inject the shell. ClawHub slugs
    # are word-chars / dashes only.
    safe_skills = [s for s in (skills or []) if s.replace("-", "").replace("_", "").isalnum()]
    skills_arg = " ".join(safe_skills)

    # The in-sandbox openclaw (2026.4.24) installs skills sandbox-wide into
    # the default workspace. Per-agent visibility is enforced by the runtime
    # via `resolveEffectiveAgentSkillFilter` in openclaw.json — when
    # agents.list[i].skills is set to a list of slugs, the agent only sees
    # those at run time. So the script (1) registers the agent, (2) installs
    # the shared skill bytes once, (3) patches openclaw.json so this agent's
    # skills filter is its own slug list. Other agents' entries are
    # preserved.
    #
    # IMPORTANT: openshell `sandbox exec` rejects shell args that contain
    # newlines. So the patch step is a single-line `python3 -c`.
    # Python is wrapped in single quotes in the shell, so the script itself
    # must NOT contain single quotes. Use double quotes throughout.
    # MERGE — never replace the existing agent entry, only add/update its
    # `skills` field. Replacing wipes workspace/agentDir/identity.
    patch_py = (
        'import json,sys;'
        'p="/sandbox/.openclaw/openclaw.json";'
        'c=json.load(open(p));'
        'a=c.setdefault("agents",{});'
        'lst=a.setdefault("list",[]);'
        'aid=sys.argv[1];'
        'skills=[s for s in sys.argv[2].split() if s];'
        'entry=next((x for x in lst if x.get("id")==aid),None);'
        'entry is None and lst.append({"id":aid}) or None;'
        'entry=entry or lst[-1];'
        'entry.update({"skills":skills}) if skills else entry.pop("skills",None);'
        'open(p,"w").write(json.dumps(c,indent=2));'
        'print("FILTER OK",aid,skills)'
    )
    script = (
        'set -u; '
        'agent_id="$1"; display_name="$2"; model="$3"; skills="$4"; '
        'workspace="/sandbox/workspaces/$agent_id"; '
        'mkdir -p "$workspace"; '
        'openclaw agents add "$agent_id" --workspace "$workspace" --model "$model" '
        '--non-interactive --json >/tmp/openclaw-agent-add.log 2>&1 || true; '
        'openclaw agents set-identity --agent "$agent_id" --name "$display_name" '
        '--json >/tmp/openclaw-agent-identity.log 2>&1 || true; '
        'for slug in $skills; do '
        '  openclaw skills install "$slug" --force '
        '    >>/tmp/openclaw-skills-install.log 2>&1 || true; '
        'done; '
        f'python3 -c \'{patch_py}\' "$agent_id" "$skills" '
        '  >/tmp/openclaw-skill-filter.log 2>&1 || true; '
        'openclaw agents list --json; '
        'echo "==SKILLS=="; '
        '(cd "$workspace" && openclaw skills list 2>/dev/null) || true; '
        'echo "==FILTER=="; '
        'cat /tmp/openclaw-skill-filter.log 2>/dev/null'
    )

    proc: asyncio.subprocess.Process | None = None
    try:
        proc = await asyncio.create_subprocess_exec(
            openshell,
            "sandbox", "exec",
            "--name", sandbox_name,
            "--workdir", "/sandbox",
            "--timeout", str(timeout_seconds),
            "--",
            "sh", "-lc", script,
            "openclaw-agent-ensure",
            claw_id, display_name, model, skills_arg,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(), timeout=timeout_seconds + 15
        )
    except asyncio.TimeoutError:
        await _terminate(proc, "ensure_openclaw_agent timed out")
        return _failure(
            claw_id, sandbox_name,
            f"ensure_openclaw_agent timed out after {timeout_seconds}s.",
            mode="timeout",
        )
    except asyncio.CancelledError:
        await _terminate(proc, "ensure_openclaw_agent cancelled")
        raise
    except Exception as exc:
        logger.exception("Unexpected error ensuring OpenClaw agent in %s", sandbox_name)
        return _failure(claw_id, sandbox_name, f"{type(exc).__name__}: {exc}", mode="unexpected")

    stdout = stdout_bytes.decode("utf-8", errors="replace")
    stderr = stderr_bytes.decode("utf-8", errors="replace")
    agents_part, _, skills_part = stdout.partition("==SKILLS==")
    found = f'"id": "{claw_id}"' in agents_part
    if proc.returncode != 0 or not found:
        logger.warning(
            "Could not ensure OpenClaw agent %s in %s: %s",
            claw_id, sandbox_name, (stderr or stdout)[:500],
        )
    if safe_skills:
        logger.info(
            "Ensured agent %s in %s with skills=%s", claw_id, sandbox_name, safe_skills,
        )
    return {
        "success": proc.returncode == 0 and found,
        "output": stdout or stderr,
        "claw_id": claw_id,
        "sandbox_name": sandbox_name,
        "skills_requested": list(safe_skills),
        "skills_status_raw": skills_part.strip()[:4000],
    }


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

def _failure(
    claw_id: str,
    sandbox_name: str,
    message: str,
    *,
    mode: str,
) -> dict[str, Any]:
    return {
        "success": False,
        "output": message,
        "files_created": [],
        "claw_id": claw_id,
        "sandbox_name": sandbox_name,
        "nemoclaw_available": False,
        "execution_mode": mode,
        "error": message,
    }


async def _terminate(proc: asyncio.subprocess.Process | None, reason: str) -> None:
    if not proc or proc.returncode is not None:
        return
    logger.info("%s; terminating pid=%s", reason, proc.pid)
    proc.terminate()
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        logger.warning("%s; killing pid=%s", reason, proc.pid)
        proc.kill()
        await proc.wait()


def _format_openclaw_message(
    task: str,
    claw_id: str,
    sandbox_name: str,
    working_dir: str,
    *,
    display_name: str | None,
    role_label: str | None,
    personality: str | None,
    tools: list[str],
    prior_turns: list[dict[str, str]],
) -> str:
    """Build the message handed to `openclaw agent --message`.

    Old version was generic ("You are OpenClaw agent X, here is the task")
    so every lobster behaved identically. Now we splice in the lobster's
    name, role, personality, and tool specialties so it acts in character.
    For coordinated multi-lobster runs we also append prior teammate
    outputs so this turn builds on what came before.
    """
    parts: list[str] = []

    if display_name and role_label:
        parts.append(
            f"You are {display_name}, the reef's {role_label} (OpenClaw agent '{claw_id}')."
        )
        if personality:
            parts.append(f"Personality: {personality}")
        if tools:
            parts.append(
                "Your specialties: " + ", ".join(tools) + ". "
                "Lean into these. Don't try to be a generalist."
            )
    else:
        parts.append(f"You are OpenClaw agent '{claw_id}'.")

    if sandbox_name == "reef-commons":
        parts.append(f"You are working from the shared reef workspace '{working_dir}'.")
    else:
        parts.append(
            f"You are working from NemoClaw sandbox '{sandbox_name}'. "
            f"Use working directory '{working_dir}'."
        )

    if prior_turns:
        parts.append("")
        parts.append("Teammate turns so far in this sandbox run:")
        for turn in prior_turns:
            name = turn.get("name", "?")
            role = turn.get("role", "")
            text = (turn.get("output") or "").strip()
            if len(text) > 800:
                text = text[:797].rstrip() + "..."
            parts.append(f"--- {name} ({role}) ---")
            parts.append(text)
        parts.append("")
        parts.append(
            "Build on what your teammates produced. Add what only you can; "
            "don't duplicate their work."
        )

    parts.append("")
    parts.append("Task:")
    parts.append(task)
    return "\n".join(parts)


def _single_line(message: str) -> str:
    """openshell exec arguments cannot contain literal newlines."""
    return " ".join(message.replace("\r", "\n").splitlines())


def _extract_openclaw_output(stdout: str) -> Any:
    """Pull the human-readable text out of OpenClaw's structured JSON."""
    parsed = _load_first_json_object(stdout)
    if not isinstance(parsed, dict):
        return stdout

    result = parsed.get("result")
    if isinstance(result, dict):
        payloads = result.get("payloads")
        if isinstance(payloads, list):
            texts = [
                item.get("text")
                for item in payloads
                if isinstance(item, dict) and isinstance(item.get("text"), str)
            ]
            if texts:
                return "\n".join(texts)
        meta = result.get("meta")
        if isinstance(meta, dict):
            visible = meta.get("finalAssistantVisibleText")
            if isinstance(visible, str) and visible:
                return visible
        return result

    for key in ("reply", "message", "output", "summary"):
        value = parsed.get(key)
        if isinstance(value, str) and value:
            return value
    return stdout


def _load_first_json_object(text: str) -> Any:
    stripped = text.lstrip()
    if not stripped:
        return None
    try:
        parsed, _idx = json.JSONDecoder().raw_decode(stripped)
        return parsed
    except (json.JSONDecodeError, TypeError):
        return None
