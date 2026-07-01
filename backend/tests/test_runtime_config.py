from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nemoclaw_reef.agents.orchestrator import Orchestrator
from nemoclaw_reef.config import settings


class _IdleChatProbe:
    def __init__(self) -> None:
        self.called = False

    async def tick(self, *, enabled: bool, forced_topic: str | None) -> None:
        self.called = True


class _NoActiveSandboxes:
    def active_sandbox_names(self) -> set[str]:
        return set()


def test_legacy_office_agents_env_prefix_is_mapped() -> None:
    env = os.environ.copy()
    env.pop("NEMOCLAW_REEF_DB_PATH", None)
    env["OFFICE_AGENTS_DB_PATH"] = "/tmp/legacy-office-agents.db"
    code = "from nemoclaw_reef.config import settings; print(settings.db_path)"
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(Path(__file__).resolve().parents[1]),
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )

    assert result.stdout.strip() == "/tmp/legacy-office-agents.db"


def test_autonomy_toggle_skips_idle_chat(monkeypatch) -> None:
    idle_chat = _IdleChatProbe()
    fake = SimpleNamespace(
        sandboxes=_NoActiveSandboxes(),
        _idle_chat=idle_chat,
        water_cooler_enabled=True,
        water_cooler_topic=None,
    )

    monkeypatch.setattr(settings, "autonomy_enabled", False)
    asyncio.run(Orchestrator._inject_idle_behavior(fake))

    assert idle_chat.called is False


def test_idle_chat_runs_when_autonomy_enabled(monkeypatch) -> None:
    idle_chat = _IdleChatProbe()
    fake = SimpleNamespace(
        sandboxes=_NoActiveSandboxes(),
        _idle_chat=idle_chat,
        water_cooler_enabled=True,
        water_cooler_topic="policy review",
    )

    monkeypatch.setattr(settings, "autonomy_enabled", True)
    asyncio.run(Orchestrator._inject_idle_behavior(fake))

    assert idle_chat.called is True
