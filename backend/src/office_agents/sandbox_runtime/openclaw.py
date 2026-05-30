"""OpenClaw subprocess wrapper for NemoClaw/OpenShell hosts.

Every code action runs inside a NemoClaw sandbox via `openshell sandbox exec`.
There is no host-local fallback: this backend is meant to live on the same
host where `openshell` and `nemoclaw` are installed. If those CLIs are missing
the call fails fast with a clear error so the UI can surface it.

The previous version had a host-local OpenClaw fallback path that masked
"missing CLI" errors with subtle subprocess failures on developer Macs. That
code is gone.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable
from uuid import uuid4

from ._subprocess import terminate_process as _terminate
from ..config import settings

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = settings.openclaw_turn_timeout_seconds
# Sourced from Settings so each demo host can override via
# OFFICE_AGENTS_SANDBOX_WORKSPACES_DIR / OFFICE_AGENTS_SANDBOX_RUNS_DIR. Kept
# as module-level constants because manager.py imports them by name.
DEFAULT_SANDBOX_WORKDIR = settings.sandbox_workspaces_dir
DEFAULT_RUNS_WORKDIR = settings.sandbox_runs_dir
_OPENCLAW_TIMEOUT_PATCH = (
    "import hashlib,json,pathlib,sys;"
    "p=pathlib.Path('/sandbox/.openclaw/openclaw.json');"
    "sys.exit(0) if not p.exists() else None;"
    "cfg=json.loads(p.read_text());"
    "value=int(sys.argv[1]);"
    "changed=False;"
    "defaults=cfg.setdefault('agents',{}).setdefault('defaults',{});"
    "changed=changed or defaults.get('timeoutSeconds')!=value;"
    "defaults['timeoutSeconds']=value;"
    "llm=defaults.setdefault('llm',{});"
    "changed=changed or llm.get('idleTimeoutSeconds')!=0;"
    "llm['idleTimeoutSeconds']=0;"
    "text=json.dumps(cfg,indent=2)+'\\n';"
    "p.write_text(text) if changed else None;"
    "h=hashlib.sha256(p.read_bytes()).hexdigest();"
    "hp=p.with_name('.config-hash');"
    "hp.write_text(f'{h}  openclaw.json\\n') if changed or hp.exists() else None;"
    "marker=p.with_name('.lobster-openclaw-timeout');"
    "desired=str(value)+'\\n';"
    "restart=changed or (not marker.exists()) or marker.read_text()!=desired;"
    "print('restart' if restart else 'ok')"
)


def _which_openshell() -> str | None:
    """Locate openshell on PATH."""
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
    # OpenClaw agents are conversational by default. Use a fresh explicit
    # session per sandbox turn so an old task cannot bleed into a new one.
    session_id: str | None = None,
    # Optional callback fired for each stderr line as it arrives. The
    # SandboxManager wires this to a `sandbox_console` WS broadcast so the
    # UI gets a live trace of what OpenClaw is doing during the turn.
    on_chunk: Callable[[str, str], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    """Run one OpenClaw agent turn inside a NemoClaw sandbox.

    Returns a result dict shaped like the rest of the codebase expects:
        {success, output, files_created, claw_id, sandbox_name,
         nemoclaw_available, execution_mode, error?}
    Never raises — failures land in the result dict so the UI can show them.
    """
    del require_sandbox  # accepted but no longer meaningful

    openshell = _which_openshell()
    if not openshell:
        msg = (
            "openshell CLI not found on PATH. "
            "This backend must run on the NemoClaw/OpenShell host."
        )
        logger.error(msg)
        return _failure(claw_id, sandbox_name, msg, mode="cli_missing")

    sandbox_workdir = working_dir or f"{DEFAULT_SANDBOX_WORKDIR}/{claw_id}"
    openclaw_session_id = session_id or f"lobster-{uuid4().hex}"
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
                'patch_status=$(python3 -c "$8" "$6") && '
                'if [ "$patch_status" = restart ]; then '
                'openclaw gateway restart >/tmp/openclaw-gateway-restart.log 2>&1 '
                '|| cat /tmp/openclaw-gateway-restart.log >&2; '
                'printf "%s\\n" "$6" >/sandbox/.openclaw/.lobster-openclaw-timeout; '
                'sleep 2; '
                'fi; '
                'thinking_args=""; '
                'if [ -n "$7" ]; then thinking_args="--thinking $7"; fi; '
                'mkdir -p "$1" && cd "$1" && exec openclaw agent '
                '--agent "$2" --session-id "$5" --json --timeout "$3" '
                '$thinking_args --message "$4"'
            ),
            "openclaw-runner",
            sandbox_workdir,
            claw_id,
            str(timeout_seconds),
            message,
            openclaw_session_id,
            str(timeout_seconds),
            settings.openclaw_thinking_level,
            _OPENCLAW_TIMEOUT_PATCH,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # Stream both pipes concurrently. OpenClaw with --json buffers
        # stdout (the JSON result) until completion, but emits stderr as it
        # works (tool calls, progress notes). Forward each stderr line to
        # on_chunk so the UI can render a live console; accumulate both
        # streams for the final result.
        stdout_buf, stderr_buf = await asyncio.wait_for(
            _stream_subprocess(proc, on_chunk),
            timeout=timeout_seconds + 45,
        )
        stdout_bytes = stdout_buf
        stderr_bytes = stderr_buf
    except asyncio.TimeoutError:
        logger.error(
            "OpenClaw run timed out after %ss in sandbox=%s",
            timeout_seconds,
            sandbox_name,
        )
        await _terminate(proc, "OpenClaw run timed out")
        return _failure(
            claw_id, sandbox_name,
            f"OpenClaw timed out after {timeout_seconds}s.",
            mode="timeout",
            session_id=openclaw_session_id,
            timed_out=True,
        )
    except asyncio.CancelledError:
        await _terminate(proc, "OpenClaw run cancelled")
        raise
    except FileNotFoundError:
        return _failure(
            claw_id,
            sandbox_name,
            "openshell binary disappeared between PATH lookup and exec.",
            mode="cli_missing",
        )
    except Exception as exc:
        logger.exception(
            "Unexpected error running OpenClaw inside sandbox %s",
            sandbox_name,
        )
        return _failure(
            claw_id,
            sandbox_name,
            f"{type(exc).__name__}: {exc}",
            mode="unexpected",
        )

    stdout = stdout_bytes.decode("utf-8", errors="replace")
    stderr = stderr_bytes.decode("utf-8", errors="replace")

    if proc.returncode != 0:
        logger.warning(
            "OpenClaw exited %s in sandbox=%s: %s",
            proc.returncode, sandbox_name, (stderr or stdout)[:500],
        )
        raw_error = stderr or stdout or f"openshell exited with code {proc.returncode}"
        return _failure(
            claw_id, sandbox_name,
            _summarize_failure_text(raw_error),
            mode="exec_failed",
            session_id=openclaw_session_id,
            diagnostics=_diagnostics_from_text(raw_error),
        )

    parsed_result = _parse_openclaw_result(stdout)
    if parsed_result.failed:
        logger.warning(
            "OpenClaw reported failure in sandbox=%s agent=%s session=%s: %s",
            sandbox_name, claw_id, openclaw_session_id, parsed_result.output[:500],
        )
        return _failure(
            claw_id, sandbox_name,
            str(parsed_result.output or "")
            or stderr
            or "OpenClaw failed before returning visible output.",
            mode=parsed_result.mode,
            session_id=openclaw_session_id,
            diagnostics=parsed_result.diagnostics,
        )

    return {
        "success": True,
        "output": parsed_result.output,
        "files_created": [],
        "claw_id": claw_id,
        "sandbox_name": sandbox_name,
        "session_id": openclaw_session_id,
        "nemoclaw_available": True,
        "execution_mode": "openshell_sandbox",
        "diagnostics": parsed_result.diagnostics,
        "partial_output": parsed_result.diagnostics.get("partial_output"),
        "tool_errors": parsed_result.diagnostics.get("tool_errors", []),
    }


async def ensure_openclaw_agent(
    *,
    sandbox_name: str,
    claw_id: str,
    display_name: str,
    model: str,
    skills: list[str] | None = None,
    working_dir: str | None = None,
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
            "openshell CLI not found on PATH. Run the backend on the NemoClaw/OpenShell host.",
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
        'workspace=sys.argv[3];'
        'entry=next((x for x in lst if x.get("id")==aid),None);'
        'entry is None and lst.append({"id":aid}) or None;'
        'entry=entry or lst[-1];'
        'entry["workspace"]=workspace;'
        'entry.update({"skills":skills}) if skills else entry.pop("skills",None);'
        'open(p,"w").write(json.dumps(c,indent=2));'
        'print("FILTER OK",aid,workspace,skills)'
    )
    workspace_arg = working_dir or f"{DEFAULT_SANDBOX_WORKDIR}/{claw_id}"
    script = (
        'set -u; '
        'agent_id="$1"; display_name="$2"; model="$3"; skills="$4"; '
        'workspace="$5"; '
        'install_failed=0; patch_failed=0; '
        ': >/tmp/openclaw-skills-install.log; '
        ': >/tmp/openclaw-skills-install-status.log; '
        'mkdir -p "$workspace"; '
        'openclaw agents add "$agent_id" --workspace "$workspace" --model "$model" '
        '--non-interactive --json >/tmp/openclaw-agent-add.log 2>&1 || true; '
        'openclaw agents set-identity --agent "$agent_id" --name "$display_name" '
        '--json >/tmp/openclaw-agent-identity.log 2>&1 || true; '
        'for slug in $skills; do '
        '  echo "== $slug ==" >>/tmp/openclaw-skills-install.log; '
        '  echo "INSTALL START $slug" >>/tmp/openclaw-skills-install-status.log; '
        '  openclaw skills install "$slug" --force '
        '    >>/tmp/openclaw-skills-install.log 2>&1 '
        '    && echo "INSTALL OK $slug" >>/tmp/openclaw-skills-install-status.log '
        '    || { echo "INSTALL FAIL $slug" >>/tmp/openclaw-skills-install-status.log; install_failed=1; }; '
        'done; '
        f'python3 -c \'{patch_py}\' "$agent_id" "$skills" "$workspace" '
        '  >/tmp/openclaw-skill-filter.log 2>&1 || patch_failed=1; '
        'openclaw agents list --json; '
        'agents_status=$?; '
        'echo "==SKILLS=="; '
        '(cd "$workspace" && openclaw skills list); '
        'skills_status=$?; '
        'echo "==FILTER=="; '
        'cat /tmp/openclaw-skill-filter.log 2>/dev/null; '
        'echo "==INSTALL_STATUS=="; '
        'cat /tmp/openclaw-skills-install-status.log 2>/dev/null; '
        'echo "==INSTALL_LOG=="; '
        'cat /tmp/openclaw-skills-install.log 2>/dev/null; '
        'if [ "$install_failed" -eq 0 ] && [ "$patch_failed" -eq 0 ] '
        '  && [ "$agents_status" -eq 0 ] && [ "$skills_status" -eq 0 ]; then exit 0; fi; '
        'exit 1'
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
            claw_id, display_name, model, skills_arg, workspace_arg,
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
    sections = _split_openclaw_sections(stdout)
    agents_part = sections.get("agents", stdout)
    skills_part = sections.get("skills", "")
    install_status = sections.get("install_status", "")
    install_log = sections.get("install_log", "")
    found = _agent_list_contains(agents_part, claw_id)
    skill_status = _parse_skill_status(
        requested=safe_skills,
        skills_raw=skills_part,
        install_status_raw=install_status,
    )
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
        "working_dir": workspace_arg,
        "skills_requested": list(safe_skills),
        "skills_status_raw": skills_part.strip()[:4000],
        "skill_status": skill_status,
        "skills_ready": skill_status["ready"],
        "skills_needs_setup": skill_status["needs_setup"],
        "skills_missing": skill_status["missing"],
        "skills_install_failed": skill_status["install_failed"],
        "skills_install_log": install_log.strip()[:4000],
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
    session_id: str | None = None,
    timed_out: bool | None = None,
    diagnostics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    detail = str(message or "").strip() or "OpenClaw run did not complete."
    diag = diagnostics.copy() if isinstance(diagnostics, dict) else {}
    if timed_out is not None:
        diag["timed_out"] = timed_out
    if "failure_detail" not in diag:
        diag["failure_detail"] = detail
    if "failure_kind" not in diag:
        diag["failure_kind"] = mode
    if "timed_out" not in diag:
        diag["timed_out"] = mode in {"timeout", "timed_out"}
    partial_output = diag.get("partial_output")
    tool_errors = diag.get("tool_errors")
    return {
        "success": False,
        "output": detail,
        "files_created": [],
        "claw_id": claw_id,
        "sandbox_name": sandbox_name,
        **({"session_id": session_id} if session_id else {}),
        "nemoclaw_available": mode != "cli_missing",
        "execution_mode": mode,
        "failure_kind": diag.get("failure_kind") or mode,
        "failure_detail": diag.get("failure_detail") or detail,
        "timed_out": bool(diag.get("timed_out")),
        "partial_output": partial_output if isinstance(partial_output, str) else None,
        "tool_errors": tool_errors if isinstance(tool_errors, list) else [],
        "diagnostics": diag,
        "error": detail,
    }


async def _stream_subprocess(
    proc: asyncio.subprocess.Process,
    on_chunk: Callable[[str, str], Awaitable[None]] | None,
) -> tuple[bytes, bytes]:
    """Read stdout + stderr concurrently, calling on_chunk(stream, line).

    Returns the accumulated stdout and stderr bytes. We need the full
    stdout for JSON parsing at the end, so we buffer it; stderr we also
    buffer for the failure-path logging.

    on_chunk is invoked per UTF-8 line (newline stripped). Exceptions
    inside on_chunk are caught and logged — they must never break the
    subprocess read loop.
    """
    if proc.stdout is None or proc.stderr is None:
        # Subprocess wasn't created with PIPE for both streams.
        return (b"", b"")

    async def drain(reader: asyncio.StreamReader, stream_name: str, buf: bytearray) -> None:
        while True:
            line = await reader.readline()
            if not line:
                return
            buf.extend(line)
            if on_chunk is None:
                continue
            try:
                text = line.decode("utf-8", errors="replace").rstrip("\r\n")
                if text:
                    await on_chunk(stream_name, text)
            except Exception:
                logger.exception("on_chunk callback raised; continuing to drain %s", stream_name)

    stdout_buf = bytearray()
    stderr_buf = bytearray()
    await asyncio.gather(
        drain(proc.stdout, "stdout", stdout_buf),
        drain(proc.stderr, "stderr", stderr_buf),
    )
    await proc.wait()
    return bytes(stdout_buf), bytes(stderr_buf)


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
    parts.append(
        "This is a fresh sandbox task turn. Treat the Task below as authoritative; "
        "do not answer an older task from session history or unrelated leftover files."
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

    parts.append(
        "NemoClaw coordinates this relay outside OpenClaw. Do not inspect "
        "OpenClaw sessions, spawn subagents, or send session messages unless "
        "the Task explicitly asks for those tools. For simple confirmation "
        "tasks, answer directly and briefly."
    )
    parts.append(
        "Respect explicit tool limits in the Task. If the Task says not to use "
        "web search, do not call web_search, web_fetch, browser, or related "
        "network tools."
    )

    parts.append("")
    parts.append("Task:")
    parts.append(task)
    return "\n".join(parts)


def _single_line(message: str) -> str:
    """openshell exec arguments cannot contain literal newlines."""
    return " ".join(message.replace("\r", "\n").splitlines())


@dataclass(frozen=True)
class _OpenClawResult:
    output: Any
    failed: bool = False
    mode: str = "openclaw_failed"
    diagnostics: dict[str, Any] = field(default_factory=dict)


def _parse_openclaw_result(stdout: str) -> _OpenClawResult:
    """Pull human-readable text out of OpenClaw JSON without hiding failures."""
    parsed = _load_first_json_object(stdout)
    if not isinstance(parsed, dict):
        diagnostics = _diagnostics_from_text(stdout)
        if _looks_like_openclaw_failure(stdout):
            mode = _failure_mode(stdout, diagnostics)
            return _OpenClawResult(_summarize_failure_text(stdout), failed=True, mode=mode, diagnostics=diagnostics)
        return _OpenClawResult(stdout, diagnostics=diagnostics)

    diagnostics = _diagnostics_from_openclaw_json(parsed)
    failure_text = _extract_openclaw_failure(parsed)
    if failure_text:
        diagnostics.setdefault("failure_detail", failure_text)
        mode = _failure_mode(failure_text, diagnostics)
        return _OpenClawResult(failure_text, failed=True, mode=mode, diagnostics=diagnostics)

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
                return _OpenClawResult("\n".join(texts), diagnostics=diagnostics)
        meta = result.get("meta")
        if isinstance(meta, dict):
            visible = meta.get("finalAssistantVisibleText")
            if isinstance(visible, str) and visible:
                return _OpenClawResult(visible, diagnostics=diagnostics)
        return _OpenClawResult(result, diagnostics=diagnostics)

    for key in ("reply", "message", "output", "summary"):
        value = parsed.get(key)
        if isinstance(value, str) and value:
            return _OpenClawResult(value, diagnostics=diagnostics)
    return _OpenClawResult(stdout, diagnostics=diagnostics)


def _diagnostics_from_openclaw_json(parsed: dict[str, Any]) -> dict[str, Any]:
    """Extract stable, UI-safe diagnostics from OpenClaw's JSON envelope."""
    diagnostics: dict[str, Any] = {
        "timed_out": _contains_true_flag(parsed, {"timedOut", "timed_out"}),
        "tool_errors": _collect_tool_errors(parsed),
    }

    partial = _extract_partial_output(parsed)
    if partial:
        diagnostics["partial_output"] = partial
        if _is_timeout_text(partial):
            diagnostics["timed_out"] = True
            diagnostics["failure_kind"] = "timeout"
            diagnostics.setdefault("failure_detail", partial)

    prompt_errors = _collect_string_values(
        parsed,
        {"promptError", "error", "errorMessage"},
    )
    if prompt_errors:
        diagnostics["failure_detail"] = prompt_errors[0]

    if diagnostics["timed_out"]:
        diagnostics["failure_kind"] = "timeout"
    elif _mentions_missing_brave_key(json.dumps(parsed, ensure_ascii=False, default=str)):
        diagnostics["failure_kind"] = "credential_missing"
        diagnostics.setdefault(
            "failure_detail",
            "Brave search was attempted but BRAVE_API_KEY is missing inside the sandbox.",
        )
    elif diagnostics["tool_errors"]:
        diagnostics["failure_kind"] = "tool_error"

    return diagnostics


def _diagnostics_from_text(text: str) -> dict[str, Any]:
    lowered = text.lower()
    diagnostics: dict[str, Any] = {
        "timed_out": _is_timeout_text(lowered),
        "tool_errors": [],
    }
    if diagnostics["timed_out"]:
        diagnostics["failure_kind"] = "timeout"
    if _mentions_missing_brave_key(text):
        diagnostics["failure_kind"] = "credential_missing"
        diagnostics["failure_detail"] = (
            "Brave search was attempted but BRAVE_API_KEY is missing inside the sandbox."
        )
        diagnostics["tool_errors"] = [
            {
                "tool": "web_search",
                "error": "missing_brave_api_key",
                "message": "BRAVE_API_KEY is not configured in the sandbox.",
            }
        ]
    elif text.strip():
        diagnostics["failure_detail"] = _summarize_failure_text(text)
    return diagnostics


def _failure_mode(text: str, diagnostics: dict[str, Any]) -> str:
    if diagnostics.get("failure_kind"):
        return str(diagnostics["failure_kind"])
    lowered = text.lower()
    if diagnostics.get("timed_out") or _is_timeout_text(lowered):
        return "timeout"
    if _mentions_missing_brave_key(text):
        return "credential_missing"
    return "openclaw_failed"


def _summarize_failure_text(text: str, limit: int = 1200) -> str:
    stripped = str(text or "").strip()
    if not stripped:
        return "OpenClaw run did not complete."
    lines = [line.strip() for line in stripped.splitlines() if line.strip()]
    summary = "\n".join(lines[:12]) if lines else stripped
    if len(summary) > limit:
        summary = summary[: limit - 3].rstrip() + "..."
    return summary


def _extract_partial_output(value: Any) -> str | None:
    texts: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, item in node.items():
                if key in {"finalAssistantVisibleText", "visibleText"} and isinstance(item, str):
                    texts.append(item)
                elif key in {"assistantTexts", "assistantText"}:
                    if isinstance(item, str):
                        texts.append(item)
                    elif isinstance(item, list):
                        texts.extend(x for x in item if isinstance(x, str))
                elif key == "payloads" and isinstance(item, list):
                    for payload in item:
                        if isinstance(payload, dict) and isinstance(payload.get("text"), str):
                            texts.append(payload["text"])
                walk(item)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(value)
    for text in texts:
        cleaned = text.strip()
        if cleaned:
            return cleaned[:4000]
    return None


def _collect_tool_errors(value: Any) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []

    def add(tool: str, error: str, message: str | None = None) -> None:
        item = {
            "tool": tool[:80] or "unknown",
            "error": error[:200] or "tool_error",
        }
        if message:
            item["message"] = message[:400]
        if item not in errors:
            errors.append(item)

    def walk(node: Any, tool_hint: str | None = None) -> None:
        if isinstance(node, dict):
            tool = (
                str(node.get("tool") or node.get("name") or node.get("slug") or tool_hint or "unknown")
            )
            for key in ("error", "errorMessage", "promptError"):
                raw = node.get(key)
                if isinstance(raw, str) and raw.strip():
                    add(tool, raw.strip(), node.get("message") if isinstance(node.get("message"), str) else None)
            raw_text = json.dumps(node, ensure_ascii=False, default=str)
            if _mentions_missing_brave_key(raw_text):
                add("web_search", "missing_brave_api_key", "BRAVE_API_KEY is not configured in the sandbox.")
            for child in node.values():
                walk(child, tool)
        elif isinstance(node, list):
            for item in node:
                walk(item, tool_hint)
        elif isinstance(node, str) and _mentions_missing_brave_key(node):
            add("web_search", "missing_brave_api_key", "BRAVE_API_KEY is not configured in the sandbox.")

    walk(value)
    return errors[:12]


def _contains_true_flag(value: Any, names: set[str]) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in names and item is True:
                return True
            if _contains_true_flag(item, names):
                return True
    elif isinstance(value, list):
        return any(_contains_true_flag(item, names) for item in value)
    return False


def _collect_string_values(value: Any, keys: set[str]) -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in keys and isinstance(item, str) and item.strip():
                found.append(item.strip())
            found.extend(_collect_string_values(item, keys))
    elif isinstance(value, list):
        for item in value:
            found.extend(_collect_string_values(item, keys))
    return found


def _mentions_missing_brave_key(text: str) -> bool:
    lowered = text.lower()
    return "missing_brave_api_key" in lowered or "brave_api_key" in lowered


def _split_openclaw_sections(stdout: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {"agents": []}
    current = "agents"
    marker_to_key = {
        "SKILLS": "skills",
        "FILTER": "filter",
        "INSTALL_STATUS": "install_status",
        "INSTALL_LOG": "install_log",
    }
    for line in stdout.splitlines():
        stripped = line.strip()
        if stripped.startswith("==") and stripped.endswith("=="):
            marker = stripped.strip("=").strip()
            key = marker_to_key.get(marker)
            if key:
                current = key
                sections.setdefault(current, [])
                continue
        sections.setdefault(current, []).append(line)
    return {key: "\n".join(lines).strip() for key, lines in sections.items()}


def _agent_list_contains(agents_part: str, claw_id: str) -> bool:
    parsed = _load_first_json_object(agents_part)
    if isinstance(parsed, list):
        return any(isinstance(item, dict) and item.get("id") == claw_id for item in parsed)
    if isinstance(parsed, dict):
        values = parsed.get("agents") or parsed.get("list") or parsed.get("items")
        if isinstance(values, list):
            return any(isinstance(item, dict) and item.get("id") == claw_id for item in values)
    return bool(re.search(rf'"id"\s*:\s*"{re.escape(claw_id)}"', agents_part))


def _parse_skill_status(
    *,
    requested: list[str],
    skills_raw: str,
    install_status_raw: str,
) -> dict[str, Any]:
    install_failed: list[str] = []
    install_succeeded: list[str] = []
    for line in install_status_raw.splitlines():
        parts = line.strip().split()
        if len(parts) < 3 or parts[0] != "INSTALL":
            continue
        status, slug = parts[1], parts[2]
        if status == "OK":
            install_succeeded.append(slug)
        elif status == "FAIL":
            install_failed.append(slug)

    ready: list[str] = []
    needs_setup: list[str] = []
    installed: list[str] = []
    missing: list[str] = []
    normalized_lines = [line.strip() for line in skills_raw.splitlines() if line.strip()]
    lowered_lines = [(line, line.lower()) for line in normalized_lines]

    for slug in requested:
        line = next((raw for raw, low in lowered_lines if _line_mentions_slug(low, slug)), "")
        low = line.lower()
        if not line:
            missing.append(slug)
        elif any(token in low for token in ("needs setup", "setup required", "not ready")):
            needs_setup.append(slug)
        elif "ready" in low or "✅" in line or "✓" in line or "✔" in line:
            ready.append(slug)
        else:
            installed.append(slug)

    for slug in install_failed:
        if slug not in missing and slug not in requested:
            missing.append(slug)

    return {
        "requested": list(requested),
        "ready": ready,
        "needs_setup": needs_setup,
        "installed": installed,
        "missing": missing,
        "install_succeeded": sorted(set(install_succeeded)),
        "install_failed": sorted(set(install_failed)),
        "raw": skills_raw.strip()[:4000],
    }


def _line_mentions_slug(line: str, slug: str) -> bool:
    return bool(re.search(rf"(^|[^a-z0-9_-]){re.escape(slug.lower())}([^a-z0-9_-]|$)", line))


def _extract_openclaw_failure(parsed: dict[str, Any]) -> str | None:
    """Return an OpenClaw error string when structured JSON says the run failed."""
    candidates: list[dict[str, Any]] = [parsed]
    result = parsed.get("result")
    if isinstance(result, dict):
        candidates.append(result)
        meta = result.get("meta")
        if isinstance(meta, dict):
            candidates.append(meta)
    partial = _extract_partial_output(parsed)
    if partial and _is_timeout_text(partial):
        return partial

    for item in candidates:
        status = item.get("status") or item.get("finalStatus")
        if (
            isinstance(status, str)
            and status.lower() in {"error", "failed", "aborted", "timeout", "timed_out"}
        ):
            return _failure_message_from(item)
        stop_reason = item.get("stopReason")
        if isinstance(stop_reason, str) and stop_reason.lower() == "aborted":
            return _failure_message_from(item)
        if any(
            item.get(flag) is True
            for flag in ("failed", "aborted", "timedOut", "timed_out")
        ):
            return _failure_message_from(item)
        for key in ("error", "errorMessage", "promptError"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _failure_message_from(item: dict[str, Any]) -> str:
    for key in ("error", "errorMessage", "promptError", "message"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "OpenClaw run did not complete."


def _is_timeout_text(text: str) -> bool:
    lowered = str(text or "").lower()
    return (
        "timed out" in lowered
        or "timeout" in lowered
        or "request timed out" in lowered
    )


def _looks_like_openclaw_failure(text: str) -> bool:
    lowered = text.lower()
    return (
        "request timed out" in lowered
        or "request was aborted" in lowered
        or "prompt-error" in lowered
    )


def _load_first_json_object(text: str) -> Any:
    stripped = text.lstrip()
    if not stripped:
        return None
    try:
        parsed, _idx = json.JSONDecoder().raw_decode(stripped)
        return parsed
    except (json.JSONDecodeError, TypeError):
        return None
