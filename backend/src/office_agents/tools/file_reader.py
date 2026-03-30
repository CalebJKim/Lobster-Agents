"""Secure local file reader with path allow-listing."""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 100_000  # characters (~100 KB of text)


async def read_file(path: str, allowed_paths: list[str]) -> str:
    """Read a local file if it resides under one of the *allowed_paths*.

    Returns the file contents (truncated to ``MAX_FILE_SIZE`` characters)
    or an error message string.
    """
    # Resolve to an absolute real path to prevent traversal tricks
    real_path = os.path.realpath(os.path.expanduser(path))

    # Security check: the resolved path must be under an allowed directory
    allowed = False
    for base in allowed_paths:
        real_base = os.path.realpath(os.path.expanduser(base))
        if real_path.startswith(real_base + os.sep) or real_path == real_base:
            allowed = True
            break

    if not allowed:
        msg = (
            f"Access denied: '{path}' is not under any allowed directory. "
            f"Allowed: {allowed_paths}"
        )
        logger.warning(msg)
        return msg

    if not os.path.isfile(real_path):
        return f"File not found: {path}"

    try:
        with open(real_path, "r", encoding="utf-8", errors="replace") as fh:
            content = fh.read(MAX_FILE_SIZE)
        if len(content) == MAX_FILE_SIZE:
            content += "\n\n... [truncated — file exceeds 100 KB]"
        return content
    except Exception as exc:
        msg = f"Error reading file '{path}': {exc}"
        logger.exception(msg)
        return msg
