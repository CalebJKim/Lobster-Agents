"""Model registry routes — list / add / activate / remove / test backends.

In-memory registry; profiles reset to ``settings``-default on backend
restart. The user can add new profiles via POST /models, switch the live
one via POST /models/{id}/activate, and probe a candidate without saving
it via POST /models/test.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from nemoclaw_reef.infra.app_state import app_state
from nemoclaw_reef.llm.client import ALLOWED_KINDS
from nemoclaw_reef.llm.registry import make_profile, test_profile

logger = logging.getLogger(__name__)

router = APIRouter()


class ModelProfileRequest(BaseModel):
    id: str | None = None
    label: str
    kind: str
    base_url: str
    model: str
    api_key: str = ""


@router.get("/models")
async def list_models() -> dict[str, object]:
    """List registered backends + which one is active."""
    reg = app_state.require_model_registry()
    return {
        "active_id": reg.active_id,
        "profiles": [p.to_public() for p in reg.list()],
        "allowed_kinds": list(ALLOWED_KINDS),
    }


@router.post("/models")
async def add_model(req: ModelProfileRequest) -> dict[str, object]:
    """Add or replace a profile. Returns the stored profile."""
    reg = app_state.require_model_registry()
    try:
        profile = make_profile(
            id=req.id,
            label=req.label,
            kind=req.kind,
            base_url=req.base_url,
            model=req.model,
            api_key=req.api_key,
        )
        stored = reg.upsert(profile)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    logger.info("Added model profile %r (kind=%s, model=%s)", stored.id, stored.kind, stored.model)
    return {"profile": stored.to_public(), "active_id": reg.active_id}


@router.delete("/models/{profile_id}")
async def delete_model(profile_id: str) -> dict[str, object]:
    reg = app_state.require_model_registry()
    try:
        reg.remove(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"No profile {profile_id!r}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    logger.info("Removed model profile %r", profile_id)
    return {"removed": profile_id, "active_id": reg.active_id}


@router.post("/models/{profile_id}/activate")
async def activate_model(profile_id: str) -> dict[str, object]:
    """Make a profile the active backend. Swaps the live LLMClient config."""
    reg = app_state.require_model_registry()
    try:
        profile = reg.set_active(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"No profile {profile_id!r}") from exc
    logger.info("Switched active LLM to %r (kind=%s, model=%s)", profile.id, profile.kind, profile.model)
    return {"active_id": reg.active_id, "profile": profile.to_public()}


@router.post("/models/test")
async def test_model(req: ModelProfileRequest) -> dict[str, object]:
    """Probe a candidate profile without registering it.

    Hits the discovery endpoint + sends a tiny chat completion so the user
    knows the model is actually responsive before adding it.
    """
    try:
        profile = make_profile(
            id=req.id,
            label=req.label or "candidate",
            kind=req.kind,
            base_url=req.base_url,
            model=req.model,
            api_key=req.api_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result = await test_profile(profile)
    return result
