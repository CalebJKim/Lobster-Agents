"""Population endpoints — add/remove lobsters at runtime.

The 7 starter lobsters are loaded at boot from `STARTER_POPULATION`.
After that, the user can spawn extras (any number of any archetype) and
remove them. Changes survive only until the backend restarts — they
re-seed from STARTER_POPULATION on next boot. (Persisting the live
roster is a future change; not needed for the demo.)
"""

from __future__ import annotations

import logging
import json
import re
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from office_agents.agents.base import Agent
from office_agents.agents.memory import AgentMemory
from office_agents.agents.roles import list_archetypes, make_lobster
from office_agents.config import settings
from office_agents.infra.app_state import app_state
from office_agents.llm.client import LLMError
from office_agents.skill_catalog import SKILL_CATALOG

logger = logging.getLogger(__name__)

router = APIRouter()


_SAFE_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9 _'\-]{0,40}$")
_SAFE_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
_JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)


_COLOR_WORDS: dict[str, str] = {
    "red": "#ef4444",
    "orange": "#f97316",
    "yellow": "#facc15",
    "green": "#22c55e",
    "blue": "#3b82f6",
    "cyan": "#22d3ee",
    "teal": "#14b8a6",
    "purple": "#7c3aed",
    "violet": "#8b5cf6",
    "pink": "#ec4899",
    "black": "#111827",
    "white": "#f8fafc",
    "silver": "#cbd5e1",
    "gold": "#f59e0b",
    "brown": "#92400e",
}

_DEFAULT_ACCENT_BY_PRIMARY = {
    "#facc15": "#7c3aed",
    "#f8fafc": "#3b82f6",
    "#111827": "#facc15",
}


class AccessoryDecoration(BaseModel):
    type: Literal["star", "dot", "stripe", "band", "gem", "pom"] = "band"
    color: str = "#facc15"
    count: int = Field(default=3, ge=1, le=8)

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str) -> str:
        return _coerce_hex_color(value, "#facc15")


class GeneratedHeadwearRequest(BaseModel):
    kind: Literal["party_hat", "wizard_hat", "top_hat", "crown", "beanie"] = "party_hat"
    label: str = Field(default="Custom hat", min_length=1, max_length=36)
    primary: str = "#7c3aed"
    accent: str | None = "#facc15"
    decorations: list[AccessoryDecoration] = Field(default_factory=list, max_length=8)

    @field_validator("primary")
    @classmethod
    def validate_primary(cls, value: str) -> str:
        return _coerce_hex_color(value, "#7c3aed")

    @field_validator("accent")
    @classmethod
    def validate_accent(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _coerce_hex_color(value, "#facc15")


class LobsterAppearanceRequest(BaseModel):
    headwear: Literal["none", "cowboy_hat", "baseball_cap", "generated"] = "none"
    eyewear: Literal["none", "sunglasses"] = "none"
    generated_headwear: GeneratedHeadwearRequest | None = None


class AddLobsterRequest(BaseModel):
    archetype: str
    name: str
    # Optional override — when the builder UI lets the user hand-pick skills,
    # we pass them in here. None means "inherit archetype defaults".
    skills: list[str] | None = None
    # Optional shell color override (#rrggbb). None falls back to the
    # name-keyed default palette on the frontend.
    color: str | None = None
    # Optional visual accessories, modeled as slots so combinations stay cheap.
    appearance: LobsterAppearanceRequest | None = None
    # Optional user-supplied mission / extra system prompt. Bolted onto
    # the archetype's personality and system_prompt at spawn time so it
    # flows into both the reef-tick LLM and every OpenClaw turn.
    mission: str | None = None


class GenerateAccessoryRequest(BaseModel):
    description: str = Field(min_length=1, max_length=240)
    slot: Literal["headwear"] = "headwear"


def _coerce_hex_color(value: str, fallback: str) -> str:
    if not isinstance(value, str):
        return fallback
    value = value.strip()
    if _SAFE_HEX_COLOR.match(value):
        return value.lower()
    return _COLOR_WORDS.get(value.lower(), fallback)


def _extract_json_object(raw: str) -> dict[str, object]:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?", "", raw.strip(), flags=re.IGNORECASE).strip()
        raw = re.sub(r"```$", "", raw).strip()
    match = _JSON_OBJECT.search(raw)
    if not match:
        raise ValueError("No JSON object found")
    data = json.loads(match.group(0))
    if not isinstance(data, dict):
        raise ValueError("Accessory response must be a JSON object")
    return data


def _fallback_accessory(description: str) -> GeneratedHeadwearRequest:
    text = description.lower()
    color_hits = [
        (match.start(), hex_color)
        for word, hex_color in _COLOR_WORDS.items()
        if (match := re.search(rf"\b{re.escape(word)}\b", text))
    ]
    colors = [hex_color for _, hex_color in sorted(color_hits)]
    primary = colors[0] if colors else "#7c3aed"
    accent = colors[1] if len(colors) > 1 else _DEFAULT_ACCENT_BY_PRIMARY.get(primary, "#facc15")

    if "wizard" in text or "magic" in text or "sorcer" in text:
        kind = "wizard_hat"
        label = "Wizard hat"
        decorations = [AccessoryDecoration(type="star", color=accent, count=4)]
    elif "crown" in text or "royal" in text:
        kind = "crown"
        label = "Crown"
        decorations = [AccessoryDecoration(type="gem", color=accent, count=3)]
    elif "top hat" in text or "formal" in text:
        kind = "top_hat"
        label = "Top hat"
        decorations = [AccessoryDecoration(type="band", color=accent, count=1)]
    elif "beanie" in text or "winter" in text or "knit" in text:
        kind = "beanie"
        label = "Beanie"
        decorations = [AccessoryDecoration(type="pom", color=accent, count=1)]
    else:
        kind = "party_hat"
        label = "Party hat"
        decorations = [AccessoryDecoration(type="dot", color=accent, count=5)]

    return GeneratedHeadwearRequest(
        kind=kind,
        label=label,
        primary=primary,
        accent=accent,
        decorations=decorations,
    )


async def _generate_accessory_with_llm(description: str) -> GeneratedHeadwearRequest:
    llm = app_state.llm
    if llm is None:
        raise LLMError("LLM client not initialized", transient=True)

    system_prompt = (
        "You convert short user descriptions into safe procedural lobster headwear specs. "
        "Return only one JSON object. No markdown. No comments. "
        "Allowed kind values: party_hat, wizard_hat, top_hat, crown, beanie. "
        "Allowed decoration type values: star, dot, stripe, band, gem, pom. "
        "Use hex colors like #7c3aed. Keep label short."
    )
    user_prompt = (
        "Create one headwear accessory for a cartoon 3D lobster from this description:\n"
        f"{description!r}\n\n"
        "JSON schema:\n"
        "{\n"
        '  "kind": "party_hat|wizard_hat|top_hat|crown|beanie",\n'
        '  "label": "short display name",\n'
        '  "primary": "#rrggbb",\n'
        '  "accent": "#rrggbb",\n'
        '  "decorations": [{"type": "star|dot|stripe|band|gem|pom", "color": "#rrggbb", "count": 1}]\n'
        "}\n"
        "Prefer wizard_hat for wizard/magic prompts, party_hat for party/birthday prompts, "
        "crown for royal prompts, top_hat for formal prompts, and beanie for winter prompts."
    )
    raw = await llm.chat(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=0.2,
        max_tokens=220,
        timeout=30.0,
    )
    data = _extract_json_object(raw)
    return GeneratedHeadwearRequest.model_validate(data)


@router.get("/archetypes")
async def get_archetypes() -> dict[str, object]:
    """List the archetype templates the user can spawn lobsters from."""

    return {"archetypes": list_archetypes()}


@router.get("/skills/catalog")
async def get_skill_catalog() -> dict[str, object]:
    """Curated ClawHub skills the builder UI can offer.

    Hand-picked subset of bundled skills that are useful for the reef demo.
    Each entry has `{slug, name, description, needs_setup}` — needs_setup
    flags ones that won't be "ready" without additional config (API keys
    for slack/github/notion, ffmpeg for summarize, etc.).
    """
    return {"skills": SKILL_CATALOG}


@router.post("/accessories/generate")
async def generate_accessory(req: GenerateAccessoryRequest) -> dict[str, object]:
    """Use the active model to turn text into a validated procedural accessory."""

    description = req.description.strip()
    try:
        accessory = await _generate_accessory_with_llm(description)
    except Exception as exc:
        logger.warning("Accessory generation fell back for %r: %s", description, exc)
        accessory = _fallback_accessory(description)
    return {"accessory": accessory.model_dump()}


@router.post("/lobsters")
async def add_lobster(req: AddLobsterRequest) -> dict[str, object]:
    """Spawn a new lobster from an archetype with the user-chosen name."""

    if not _SAFE_NAME.match(req.name):
        raise HTTPException(
            status_code=400,
            detail="Name must start with a letter, max 40 chars, letters/digits/spaces/underscores/hyphens/apostrophes only.",
        )
    if req.color is not None and not _SAFE_HEX_COLOR.match(req.color):
        raise HTTPException(
            status_code=400,
            detail="Color must be a 6-digit hex string like #76b900.",
        )

    orch = app_state.require_orchestrator()
    if any(a.name == req.name for a in orch.agents):
        raise HTTPException(
            status_code=409,
            detail=f"A lobster named {req.name!r} already exists.",
        )

    try:
        role_config = make_lobster(
            req.name,
            req.archetype,
            skills_override=tuple(req.skills) if req.skills is not None else None,
            mission=req.mission,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    llm = app_state.llm
    if llm is None:
        raise HTTPException(status_code=503, detail="LLM client not initialized")

    mem = AgentMemory(agent_name=req.name, db_path=settings.db_path)
    await mem.init_db()
    agent = Agent(
        role_config=role_config,
        llm_client=llm,
        memory=mem,
        color=req.color,
        appearance=req.appearance.model_dump() if req.appearance else None,
    )

    # Agent.__init__ defaults unknown names to war_room (168, 376). Spawning
    # multiple lobsters in a row would pile them all on the same point until
    # the reef-chat tick wandered them apart. Reseat them in break_room
    # with a unique slot from the room's seat tracker so they appear at
    # distinct positions immediately.
    from office_agents.office.layout import get_room_position
    agent.location = "break_room"
    agent.position = get_room_position("break_room", agent.name)

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
