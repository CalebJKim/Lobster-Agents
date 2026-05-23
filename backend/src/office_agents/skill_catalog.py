"""Curated catalog of ClawHub skills exposed to the lobster builder UI.

This is a hand-picked subset of the 51 bundled skills that are relevant for
the demo + actually installable on the Spark sandbox. The full
`openclaw skills list` catalog is dynamic and includes a lot of host-specific
integrations (Apple Notes, BluOS, Hue lights, etc.) that don't make sense in
the demo. The list here is what we'd recommend a reef visitor pick from.

Slugs match real ClawHub package names — `openclaw skills install <slug>`
inside a sandbox should work for all of them. Some need additional setup
(API keys, ffmpeg, etc.) before they're "ready"; those are tagged.
"""

from __future__ import annotations


SKILL_CATALOG: list[dict[str, str | bool]] = [
    {
        "slug": "summarize",
        "name": "Summarize",
        "description": "Summarize or transcribe URLs, YouTube videos, audio, or text.",
        "needs_setup": True,  # wants ffmpeg / whisper for media inputs
    },
    {
        "slug": "oracle",
        "name": "Oracle",
        "description": "Bundle prompts and files for second-opinion verification via the oracle CLI.",
        "needs_setup": False,
    },
    {
        "slug": "taskflow",
        "name": "TaskFlow",
        "description": "Coordinate multi-step detached tasks as one durable workflow.",
        "needs_setup": False,
    },
    {
        "slug": "skill-creator",
        "name": "Skill Creator",
        "description": "Create, edit, audit, or restructure OpenClaw skills and SKILL.md files.",
        "needs_setup": False,
    },
    {
        "slug": "session-logs",
        "name": "Session Logs",
        "description": "Search and analyze your own OpenClaw session logs (older / archived).",
        "needs_setup": False,
    },
    {
        "slug": "model-usage",
        "name": "Model Usage",
        "description": "Summarize CodexBar local cost logs by model for Codex / GPT runs.",
        "needs_setup": False,
    },
    {
        "slug": "mcporter",
        "name": "MCPorter",
        "description": "List, configure, authenticate, call, and inspect MCP servers.",
        "needs_setup": True,
    },
    {
        "slug": "coding-agent",
        "name": "Coding Agent",
        "description": "Delegate coding tasks to Codex, Claude Code, OpenCode, or Pi agents.",
        "needs_setup": True,
    },
    {
        "slug": "github",
        "name": "GitHub",
        "description": "Use gh for GitHub issues, PR status, CI/logs, and PR review work.",
        "needs_setup": True,
    },
    {
        "slug": "gh-issues",
        "name": "GitHub Issues",
        "description": "Fetch GitHub issues, delegate fixes to subagents.",
        "needs_setup": True,
    },
    {
        "slug": "browser-automation",
        "name": "Browser Automation",
        "description": "Control web pages with the OpenClaw browser bridge.",
        "needs_setup": False,
    },
    {
        "slug": "healthcheck",
        "name": "Healthcheck",
        "description": "Audit and harden hosts running OpenClaw (SSH, ports, services).",
        "needs_setup": False,
    },
    {
        "slug": "notion",
        "name": "Notion",
        "description": "Notion API for creating and managing pages, blocks, and databases.",
        "needs_setup": True,
    },
    {
        "slug": "slack",
        "name": "Slack",
        "description": "React, pin/unpin, send, edit, and inspect Slack messages.",
        "needs_setup": True,
    },
    {
        "slug": "weather",
        "name": "Weather",
        "description": "Get current weather, rain, temperature, and forecasts.",
        "needs_setup": False,
    },
]
