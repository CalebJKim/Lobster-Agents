"""Application state container — what the routes need from the running app.

Replaces the module-level globals that used to live at the top of `main.py`.
The lifespan handler populates this on startup; route modules import the
``app_state`` singleton and read from it.

Why not FastAPI dependency injection? Because the orchestrator is an async
background task that gets stopped/restarted on lifespan transitions, and a
plain singleton lets routes keep their signatures clean without dragging
``Request: Request`` through every handler.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import asyncio

    from office_agents.agents.orchestrator import Orchestrator
    from office_agents.infra.broadcaster import Broadcaster
    from office_agents.llm.client import LLMClient
    from office_agents.office.state import OfficeState


@dataclass
class AppState:
    """Singleton populated during FastAPI lifespan startup."""

    orchestrator: "Orchestrator | None" = None
    office_state: "OfficeState | None" = None
    llm: "LLMClient | None" = None
    broadcaster: "Broadcaster | None" = None
    sim_task: "asyncio.Task[None] | None" = None

    def require_orchestrator(self) -> "Orchestrator":
        if self.orchestrator is None:
            raise RuntimeError("Orchestrator not initialized")
        return self.orchestrator

    def require_office_state(self) -> "OfficeState":
        if self.office_state is None:
            raise RuntimeError("Office state not initialized")
        return self.office_state

    def require_broadcaster(self) -> "Broadcaster":
        if self.broadcaster is None:
            raise RuntimeError("Broadcaster not initialized")
        return self.broadcaster


app_state = AppState()
