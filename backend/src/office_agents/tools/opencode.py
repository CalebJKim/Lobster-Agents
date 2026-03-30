"""Integration with Claude Code CLI for code generation."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_WORKING_DIR = "/tmp/office-agents-code"


async def run_opencode(
    task: str,
    working_dir: str = DEFAULT_WORKING_DIR,
) -> dict[str, Any]:
    """Invoke the Claude Code CLI to generate code for *task*.

    Returns a dict with keys:
    - ``success`` (bool)
    - ``output``  (str)  — raw stdout from the CLI
    - ``files_created`` (list[str]) — any new files detected in *working_dir*
    """
    os.makedirs(working_dir, exist_ok=True)

    # Snapshot existing files so we can diff afterward
    existing_files = set(_list_files(working_dir))

    try:
        proc = await asyncio.create_subprocess_exec(
            "claude",
            "--print",
            "--output-format",
            "json",
            "-p",
            task,
            cwd=working_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(), timeout=120
        )

        stdout = stdout_bytes.decode("utf-8", errors="replace")
        stderr = stderr_bytes.decode("utf-8", errors="replace")

        # Detect newly created files
        current_files = set(_list_files(working_dir))
        new_files = sorted(current_files - existing_files)

        # Try to parse structured JSON output from the CLI
        output_text = stdout
        try:
            parsed = json.loads(stdout)
            if isinstance(parsed, dict):
                output_text = parsed.get("result", stdout)
        except (json.JSONDecodeError, TypeError):
            pass

        if proc.returncode != 0:
            logger.warning(
                "Claude Code CLI exited with code %s: %s",
                proc.returncode,
                stderr[:500],
            )
            return {
                "success": False,
                "output": stderr or stdout,
                "files_created": new_files,
            }

        return {
            "success": True,
            "output": output_text,
            "files_created": new_files,
        }

    except FileNotFoundError:
        msg = (
            "Claude Code CLI ('claude') not found on PATH. "
            "Install it or ensure it's available."
        )
        logger.error(msg)
        return {"success": False, "output": msg, "files_created": []}
    except asyncio.TimeoutError:
        logger.error("Claude Code CLI timed out after 120 seconds")
        return {
            "success": False,
            "output": "Code generation timed out after 120 seconds.",
            "files_created": [],
        }
    except Exception as exc:
        logger.exception("Unexpected error running Claude Code CLI")
        return {"success": False, "output": str(exc), "files_created": []}


def _list_files(directory: str) -> list[str]:
    """Recursively list all files under *directory*."""
    result: list[str] = []
    for root, _dirs, files in os.walk(directory):
        for f in files:
            result.append(os.path.join(root, f))
    return result
