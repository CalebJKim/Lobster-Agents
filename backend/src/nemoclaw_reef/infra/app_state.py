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

    from nemoclaw_reef.agents.orchestrator import Orchestrator
    from nemoclaw_reef.infra.broadcaster import Broadcaster
    from nemoclaw_reef.llm.client import LLMClient
    from nemoclaw_reef.llm.registry import ModelRegistry
    from nemoclaw_reef.state.reef_state import ReefState


@dataclass
class AppState:
    """Singleton populated during FastAPI lifespan startup."""

    orchestrator: "Orchestrator | None" = None
    reef_state: "ReefState | None" = None
    llm: "LLMClient | None" = None
    model_registry: "ModelRegistry | None" = None
    broadcaster: "Broadcaster | None" = None
    sim_task: "asyncio.Task[None] | None" = None

    def require_orchestrator(self) -> "Orchestrator":
        if self.orchestrator is None:
            raise RuntimeError("Orchestrator not initialized")
        return self.orchestrator

    def require_reef_state(self) -> "ReefState":
        if self.reef_state is None:
            raise RuntimeError("Reef state not initialized")
        return self.reef_state

    def require_broadcaster(self) -> "Broadcaster":
        if self.broadcaster is None:
            raise RuntimeError("Broadcaster not initialized")
        return self.broadcaster

    def require_model_registry(self) -> "ModelRegistry":
        if self.model_registry is None:
            raise RuntimeError("Model registry not initialized")
        return self.model_registry


app_state = AppState()
