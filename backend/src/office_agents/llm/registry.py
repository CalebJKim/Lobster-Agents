"""Model registry — tracks available LLM backends and the active one.

The shared ``LLMClient`` instance lives on ``app_state.llm`` and is what every
Agent reads through. When the user activates a different profile we
reconfigure that same client in place, so we don't need to walk every Agent
to swap a reference.

Profiles are kept in memory only — the demo restarts cleanly back to the
``settings``-defined default profile, plus any extras the user adds via the
UI during a session. Persistence across backend restarts would mean
introducing a config file; not needed yet.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

from office_agents.llm.client import (
    ALLOWED_KINDS,
    KIND_OLLAMA,
    KIND_OPENAI,
    LLMClient,
    LLMError,
)


_SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9_\-]{0,40}$")


@dataclass
class ModelProfile:
    """One model backend the user can switch to."""

    id: str               # stable kebab/slug, used in URLs
    label: str            # human-readable name shown in the UI
    kind: str             # "ollama" | "openai"
    base_url: str         # http://host:port, with or without /v1
    model: str            # model identifier the backend serves
    api_key: str = ""     # optional bearer token (OpenAI-style endpoints)

    def to_public(self) -> dict[str, Any]:
        """Serialize for the API. Strip the api_key so it doesn't leak."""
        d = asdict(self)
        d["api_key_set"] = bool(d.pop("api_key", ""))
        return d


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:40] or "profile"


class ModelRegistry:
    """In-memory store of model profiles + which one is active.

    Holds a reference to the shared LLMClient so set_active() can swap the
    backend in place without touching agents.
    """

    def __init__(self, *, client: LLMClient, initial: ModelProfile) -> None:
        self._client = client
        self._profiles: dict[str, ModelProfile] = {initial.id: initial}
        self._active_id = initial.id

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def list(self) -> list[ModelProfile]:
        return list(self._profiles.values())

    def active(self) -> ModelProfile:
        return self._profiles[self._active_id]

    @property
    def active_id(self) -> str:
        return self._active_id

    # ------------------------------------------------------------------
    # Mutate
    # ------------------------------------------------------------------

    def upsert(self, profile: ModelProfile) -> ModelProfile:
        """Add or replace a profile. Returns the stored copy.

        Validates id format and kind. Does NOT reach out to the endpoint;
        use ``test_profile()`` for that.
        """
        if not _SAFE_ID.match(profile.id):
            raise ValueError(
                f"Invalid profile id {profile.id!r}. Use lowercase letters, "
                "digits, hyphens or underscores (40 chars max)."
            )
        if profile.kind not in ALLOWED_KINDS:
            raise ValueError(
                f"Unknown kind {profile.kind!r}; allowed: {ALLOWED_KINDS}"
            )
        if not profile.label.strip():
            raise ValueError("Profile label cannot be empty.")
        if not profile.model.strip():
            raise ValueError("Profile model cannot be empty.")
        if not profile.base_url.strip():
            raise ValueError("Profile base_url cannot be empty.")
        self._profiles[profile.id] = profile
        return profile

    def remove(self, profile_id: str) -> None:
        if profile_id not in self._profiles:
            raise KeyError(profile_id)
        if profile_id == self._active_id:
            raise ValueError(
                "Cannot remove the active profile. Activate a different one first."
            )
        del self._profiles[profile_id]

    def set_active(self, profile_id: str) -> ModelProfile:
        if profile_id not in self._profiles:
            raise KeyError(profile_id)
        p = self._profiles[profile_id]
        self._client.reconfigure(
            base_url=p.base_url,
            api_key=p.api_key,
            model=p.model,
            kind=p.kind,
        )
        self._active_id = profile_id
        return p


async def test_profile(profile: ModelProfile) -> dict[str, Any]:
    """Probe an endpoint without registering it.

    Spins up a throwaway client, hits the discovery endpoint, then sends a
    tiny chat completion to confirm the model actually responds. Cleans up
    the temp httpx client on the way out.
    """
    client = LLMClient(
        base_url=profile.base_url,
        api_key=profile.api_key,
        model=profile.model,
        kind=profile.kind,
    )
    try:
        ping = await client.ping(timeout_seconds=5.0)
        if not ping["reachable"]:
            return {"ok": False, "error": str(ping.get("error") or "unreachable")}
        try:
            sample = await client.chat(
                system_prompt="Reply with exactly: ok",
                user_prompt="ping",
                temperature=0.1,
                max_tokens=12,
                timeout=20.0,
            )
        except LLMError as exc:
            return {"ok": False, "error": f"chat failed: {exc}", "ping": ping}
        return {"ok": True, "ping": ping, "sample": (sample or "")[:120]}
    finally:
        try:
            await client.client.aclose()
        except Exception:
            pass


def default_profile_from_settings() -> ModelProfile:
    """Build the seed profile from ``settings`` so the registry has a baseline."""

    from office_agents.config import settings

    base = (settings.llm_base_url or "").rstrip("/")
    kind = KIND_OLLAMA
    # Heuristic: a /v1-ending base_url usually means an OpenAI-compatible
    # gateway; Ollama is usually served on :11434 with /api/* paths.
    if base.endswith("/v1") and "11434" not in base:
        kind = KIND_OPENAI

    label = "Local Ollama" if kind == KIND_OLLAMA else "Default OpenAI-compatible"
    return ModelProfile(
        id=_slugify(label),
        label=label,
        kind=kind,
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        api_key=settings.llm_api_key,
    )


# Extra profiles seeded at startup alongside the settings-default one. These
# are the backends we've verified work in this environment; the user can
# still add more via the /models route at runtime.
EXTRA_SEED_PROFILES: list[ModelProfile] = [
    ModelProfile(
        id="vllm-qwen36-27b-mtp",
        label="vLLM Qwen3.6 27B MTP",
        kind=KIND_OPENAI,
        base_url="http://127.0.0.1:8000/v1",
        model="qwen3.6-27b-mtp",
        api_key="",
    ),
]


def make_profile(
    *,
    id: str | None,
    label: str,
    kind: str,
    base_url: str,
    model: str,
    api_key: str = "",
) -> ModelProfile:
    """Construct a profile, auto-slugging the id from the label if omitted."""
    profile_id = (id or _slugify(label)).strip()
    return ModelProfile(
        id=profile_id,
        label=label.strip(),
        kind=kind.strip(),
        base_url=base_url.strip(),
        model=model.strip(),
        api_key=api_key.strip(),
    )
