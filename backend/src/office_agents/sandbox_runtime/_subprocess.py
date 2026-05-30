"""Shared subprocess helpers for the sandbox_runtime layer.

Both nemoclaw.py and openclaw.py spawn external CLIs (nemoclaw / openshell /
openclaw). They face the same hazards:

  * timeouts must terminate cleanly without leaving zombies,
  * SIGKILL alone is not safe — the subsequent ``communicate()`` can hang
    indefinitely if the kernel has not fully reaped the process,
  * we always want UTF-8 captures with replacement on invalid bytes.

The previous nemoclaw.py pattern was::

    try:
        await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()   # <-- unbounded; could hang forever

``run_capture`` below replaces that pattern at five call sites in nemoclaw.py
and keeps termination consistent with openclaw.py.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


async def terminate_process(
    proc: asyncio.subprocess.Process | None, reason: str
) -> None:
    """Graceful SIGTERM, escalate to SIGKILL after 5 s. Safe with None.

    Used at timeout/error boundaries. The 5 s wait gives well-behaved children
    a chance to flush stdout/stderr; we escalate to kill only if they ignore
    SIGTERM.
    """
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


@dataclass(slots=True)
class CapturedRun:
    """Captured output of a subprocess invoked via ``run_capture``."""

    returncode: int
    stdout: str
    stderr: str
    timed_out: bool


async def run_capture(
    *cmd: str,
    timeout_seconds: float,
    cwd: str | None = None,
    env: dict[str, str] | None = None,
) -> CapturedRun:
    """Run a command to completion (or timeout), capturing UTF-8 output.

    On timeout, terminates the process gracefully via :func:`terminate_process`
    and returns ``timed_out=True`` with whatever was captured before
    termination. Crucially, the post-termination drain has its own short
    bounded wait so this function can never hang on a wedged child.
    """
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
        env=env,
    )
    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(), timeout=timeout_seconds
        )
        return CapturedRun(
            returncode=proc.returncode if proc.returncode is not None else 0,
            stdout=stdout_bytes.decode("utf-8", errors="replace"),
            stderr=stderr_bytes.decode("utf-8", errors="replace"),
            timed_out=False,
        )
    except asyncio.TimeoutError:
        await terminate_process(proc, f"timeout after {timeout_seconds}s")
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(), timeout=2
            )
        except asyncio.TimeoutError:
            stdout_bytes, stderr_bytes = b"", b""
        return CapturedRun(
            returncode=proc.returncode if proc.returncode is not None else -1,
            stdout=stdout_bytes.decode("utf-8", errors="replace"),
            stderr=stderr_bytes.decode("utf-8", errors="replace"),
            timed_out=True,
        )
