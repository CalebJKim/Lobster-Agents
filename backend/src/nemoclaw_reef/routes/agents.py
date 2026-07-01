"""Population endpoints — add/remove lobsters at runtime.

The 7 starter lobsters are loaded at boot from `STARTER_POPULATION`.
After that, the user can spawn extras (any number of any archetype) and
remove them. Changes survive only until the backend restarts — they
re-seed from STARTER_POPULATION on next boot. (Persisting the live
roster is a future change; not needed for the demo.)
"""

from __future__ import annotations

import logging
import html
import io
import json
import re
import zipfile
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

from nemoclaw_reef.agents.base import Agent
from nemoclaw_reef.agents.memory import AgentMemory
from nemoclaw_reef.agents.roles import list_archetypes, make_lobster
from nemoclaw_reef.config import settings
from nemoclaw_reef.infra.app_state import app_state
from nemoclaw_reef.llm.client import LLMError
from nemoclaw_reef.skill_catalog import SKILL_CATALOG

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
    species: Literal["lobster", "crab"] = "lobster"
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
            species=req.species,
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
    from nemoclaw_reef.state.layout import get_room_position
    agent.location = "break_room"
    agent.position = get_room_position("break_room", agent.name)

    await orch.add_lobster(agent)
    reef = app_state.reef_state
    store = reef.get_store() if reef else None
    if store:
        await store.save_visitor_agent(
            name=agent.name,
            species=agent.species,
            runtime=agent.runtime,
            archetype=req.archetype,
            role=agent.role,
            color=agent.color,
            appearance=agent.appearance,
            skills=list(agent.openclaw_skills),
            mission=req.mission,
            profile=_passport_for_agent(agent, req.archetype, req.mission),
        )
    logger.info("Spawned %s %r (archetype=%s)", req.species, req.name, req.archetype)
    return {
        "status": "ok",
        "lobster": agent.to_info(),
        "agent": agent.to_info(),
        "export": {
            "passport_url": f"/lobsters/{agent.name}/passport",
            "portrait_url": f"/lobsters/{agent.name}/portrait.svg",
            "package_url": f"/lobsters/{agent.name}/export",
        },
    }


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

    reef = app_state.reef_state
    store = reef.get_store() if reef else None
    if store:
        await store.delete_visitor_agent(name)

    logger.info("Removed lobster %r", name)
    return {"status": "ok", "removed": name}


@router.get("/lobsters/{name}/passport")
async def get_lobster_passport(name: str) -> dict[str, object]:
    """Return a reusable JSON description for a visitor-built agent."""

    return await _passport_response(name)


@router.get("/lobsters/{name}/portrait.svg")
async def get_lobster_portrait(name: str) -> Response:
    """Return a lightweight portable portrait for a visitor-built agent."""

    passport = await _passport_response(name)
    svg = _portrait_svg(passport)
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={"Content-Disposition": f'inline; filename="{_safe_filename(name)}-portrait.svg"'},
    )


@router.get("/lobsters/{name}/export")
async def export_lobster(name: str) -> Response:
    """Download agent.json + portrait + OpenClaw install helper as a zip."""

    passport = await _passport_response(name)
    portrait = _portrait_svg(passport)
    readme = _export_readme(passport)
    install = _install_script(passport)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("agent.json", json.dumps(passport, indent=2, sort_keys=True))
        zf.writestr("portrait.svg", portrait)
        zf.writestr("README.md", readme)
        zf.writestr("install-openclaw-agent.sh", install)
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{_safe_filename(name)}-openclaw-agent.zip"'},
    )


async def _passport_response(name: str) -> dict[str, object]:
    reef = app_state.reef_state
    store = reef.get_store() if reef else None
    record = await store.get_visitor_agent(name) if store else None
    if record and isinstance(record.get("profile"), dict):
        profile = dict(record["profile"])
        profile["saved_at"] = record.get("updated_at")
        return profile

    orch = app_state.require_orchestrator()
    agent = next((a for a in orch.agents if a.name == name), None)
    if not agent:
        raise HTTPException(status_code=404, detail=f"No lobster named {name!r}.")
    return _passport_for_agent(agent, "custom", None)


def _passport_for_agent(agent: Agent, archetype: str, mission: str | None) -> dict[str, object]:
    info = agent.to_info()
    return {
        "schema_version": "lobster-agent.v1",
        "name": agent.name,
        "species": agent.species,
        "runtime": agent.runtime,
        "archetype": archetype,
        "role": agent.role,
        "mission": mission or "",
        "skills": list(agent.openclaw_skills),
        "traits": list(agent.tools),
        "color": agent.color,
        "appearance": agent.appearance,
        "created_at": datetime.now().isoformat(),
        "openclaw": {
            "agent_id": agent.claw_id,
            "recommended_model": "user-configured",
            "install_hint": "Set OPENCLAW_MODEL, then run install-openclaw-agent.sh.",
        },
        "profile": info,
    }


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-")
    return cleaned[:80] or "openclaw-agent"


def _portrait_svg(passport: dict[str, object]) -> str:
    name = html.escape(str(passport.get("name") or "Agent"))
    species = str(passport.get("species") or "lobster")
    role = html.escape(str(passport.get("role") or "agent"))
    color = str(passport.get("color") or "#38bdf8")
    if not _SAFE_HEX_COLOR.match(color):
        color = "#38bdf8"
    appearance = passport.get("appearance")
    if not isinstance(appearance, dict):
        appearance = {}
    headwear = str(appearance.get("headwear") or "none")
    generated = appearance.get("generated_headwear")
    hat_color = "#f59e0b"
    accent = "#facc15"
    if isinstance(generated, dict):
        hat_color = str(generated.get("primary") or hat_color)
        accent = str(generated.get("accent") or accent)
    if not _SAFE_HEX_COLOR.match(hat_color):
        hat_color = "#f59e0b"
    if not _SAFE_HEX_COLOR.match(accent):
        accent = "#facc15"

    if species == "crab":
        body = (
            f'<ellipse cx="300" cy="206" rx="86" ry="58" fill="{color}"/>'
            f'<circle cx="218" cy="200" r="30" fill="{color}"/>'
            f'<circle cx="382" cy="200" r="30" fill="{color}"/>'
            '<line x1="245" y1="248" x2="204" y2="288" stroke="#0f172a" stroke-width="10" stroke-linecap="round"/>'
            '<line x1="355" y1="248" x2="396" y2="288" stroke="#0f172a" stroke-width="10" stroke-linecap="round"/>'
        )
    else:
        body = (
            f'<ellipse cx="300" cy="210" rx="96" ry="55" fill="{color}"/>'
            f'<ellipse cx="405" cy="210" rx="42" ry="28" fill="{color}"/>'
            '<polygon points="448,210 508,176 504,244" fill="#0f172a" opacity="0.18"/>'
            '<line x1="225" y1="238" x2="170" y2="282" stroke="#0f172a" stroke-width="9" stroke-linecap="round"/>'
            '<line x1="375" y1="238" x2="430" y2="282" stroke="#0f172a" stroke-width="9" stroke-linecap="round"/>'
        )

    hat = ""
    if headwear == "generated":
        hat = (
            f'<polygon points="270,148 300,78 330,148" fill="{hat_color}"/>'
            f'<rect x="264" y="142" width="72" height="14" rx="7" fill="{accent}"/>'
        )
    elif headwear != "none":
        hat = (
            f'<rect x="252" y="118" width="96" height="28" rx="12" fill="{hat_color}"/>'
            f'<rect x="232" y="144" width="136" height="16" rx="8" fill="{accent}"/>'
        )

    eyewear = ""
    if appearance.get("eyewear") == "sunglasses":
        eyewear = (
            '<rect x="258" y="188" width="34" height="20" rx="8" fill="#020617"/>'
            '<rect x="308" y="188" width="34" height="20" rx="8" fill="#020617"/>'
            '<line x1="292" y1="198" x2="308" y2="198" stroke="#020617" stroke-width="5"/>'
        )

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 420" role="img" aria-label="{name} portrait">
  <rect width="600" height="420" fill="#082f49"/>
  <circle cx="110" cy="84" r="44" fill="#67e8f9" opacity="0.18"/>
  <circle cx="498" cy="102" r="70" fill="#34d399" opacity="0.12"/>
  <path d="M0 322 C120 280 204 360 336 318 C442 284 520 300 600 262 L600 420 L0 420 Z" fill="#ecfeff" opacity="0.18"/>
  {body}
  <circle cx="272" cy="180" r="9" fill="#020617"/>
  <circle cx="328" cy="180" r="9" fill="#020617"/>
  {eyewear}
  {hat}
  <text x="300" y="346" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="800" fill="#ecfeff">{name}</text>
  <text x="300" y="374" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="700" fill="#bae6fd">{html.escape(species.title())} / {role}</text>
</svg>
'''


def _export_readme(passport: dict[str, object]) -> str:
    name = str(passport.get("name") or "OpenClaw agent")
    skills = passport.get("skills")
    skill_text = ", ".join(skills) if isinstance(skills, list) and skills else "none"
    return (
        f"# {name}\n\n"
        "This package was exported from NemoClaw Reef.\n\n"
        "- `agent.json`: portable profile metadata\n"
        "- `portrait.svg`: visual keepsake\n"
        "- `install-openclaw-agent.sh`: helper for creating a local OpenClaw profile\n\n"
        f"Skills: {skill_text}\n\n"
        "To install, set `OPENCLAW_MODEL` for your own environment and run:\n\n"
        "```bash\nchmod +x install-openclaw-agent.sh\n./install-openclaw-agent.sh\n```\n"
    )


def _install_script(passport: dict[str, object]) -> str:
    name = str(passport.get("name") or "OpenClaw Agent")
    openclaw = passport.get("openclaw") if isinstance(passport.get("openclaw"), dict) else {}
    agent_id = str(openclaw.get("agent_id") or _safe_filename(name).lower())
    skills = passport.get("skills")
    skill_lines = ""
    if isinstance(skills, list):
        for skill in skills:
            slug = re.sub(r"[^A-Za-z0-9_.-]+", "", str(skill))
            if slug:
                skill_lines += f'openclaw skills install "{slug}" --force || true\n'
    return (
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n\n"
        f'AGENT_ID="{agent_id}"\n'
        f'DISPLAY_NAME="{name.replace(chr(34), "")}"\n'
        'WORKSPACE="${OPENCLAW_WORKSPACE:-$PWD/$AGENT_ID}"\n'
        'MODEL="${OPENCLAW_MODEL:-inference/your-model-here}"\n\n'
        'mkdir -p "$WORKSPACE"\n'
        'openclaw agents add "$AGENT_ID" --workspace "$WORKSPACE" --model "$MODEL" --non-interactive || true\n'
        'openclaw agents set-identity --agent "$AGENT_ID" --name "$DISPLAY_NAME" || true\n'
        f"{skill_lines}"
        'printf "Installed %s at %s using model %s\\n" "$DISPLAY_NAME" "$WORKSPACE" "$MODEL"\n'
    )
