"""Population endpoints — add/remove lobsters at runtime.

The 7 starter lobsters are loaded at boot from `STARTER_POPULATION`.
After that, the user can spawn extras (any number of any archetype) and
remove them. Changes survive only until the backend restarts — they
re-seed from STARTER_POPULATION on next boot. (Persisting the live
roster is a future change; not needed for the demo.)
"""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from office_agents.agents.base import Agent
from office_agents.agents.memory import AgentMemory
from office_agents.agents.roles import list_archetypes, make_lobster
from office_agents.config import settings
from office_agents.infra.app_state import app_state

logger = logging.getLogger(__name__)

router = APIRouter()


_SAFE_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9 _'\-]{0,40}$")


class AddLobsterRequest(BaseModel):
    archetype: str
    name: str


@router.get("/archetypes")
async def get_archetypes() -> dict[str, object]:
    """List the archetype templates the user can spawn lobsters from."""

    return {"archetypes": list_archetypes()}


@router.post("/lobsters")
async def add_lobster(req: AddLobsterRequest) -> dict[str, object]:
    """Spawn a new lobster from an archetype with the user-chosen name."""

    if not _SAFE_NAME.match(req.name):
        raise HTTPException(
            status_code=400,
            detail="Name must start with a letter, max 40 chars, letters/digits/spaces/underscores/hyphens/apostrophes only.",
        )

    orch = app_state.require_orchestrator()
    if any(a.name == req.name for a in orch.agents):
        raise HTTPException(
            status_code=409,
            detail=f"A lobster named {req.name!r} already exists.",
        )

    try:
        role_config = make_lobster(req.name, req.archetype)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    llm = app_state.llm
    if llm is None:
        raise HTTPException(status_code=503, detail="LLM client not initialized")

    mem = AgentMemory(agent_name=req.name, db_path=settings.db_path)
    await mem.init_db()
    agent = Agent(role_config=role_config, llm_client=llm, memory=mem)

    await orch.add_lobster(agent)
    logger.info("Spawned lobster %r (archetype=%s)", req.name, req.archetype)
    return {"status": "ok", "lobster": agent.to_info()}


@router.delete("/lobsters/{name}")
async def delete_lobster(name: str) -> dict[str, object]:
    """Remove a lobster. Fails with 409 if they're in an active sandbox run."""

    orch = app_state.require_orchestrator()
    try:
        removed = await orch.remove_lobster(name)
    except RuntimeError as exc:
        # Active sandbox run blocks removal.
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    if not removed:
        raise HTTPException(status_code=404, detail=f"No lobster named {name!r}.")

    logger.info("Removed lobster %r", name)
    return {"status": "ok", "removed": name}
