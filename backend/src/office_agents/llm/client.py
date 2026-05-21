"""Async LLM client — Ollama native API (think disabled)."""

from __future__ import annotations

import logging
import re
import time

import httpx

logger = logging.getLogger(__name__)


class LLMError(Exception):
    """Raised when the LLM cannot produce a usable response.

    Callers that want to render a fallback should catch this explicitly; never
    rely on chat() returning an empty string for "the LLM is broken." That used
    to be the contract and it spread silent garbage through the simulation.
    """

    def __init__(self, message: str, *, transient: bool = True) -> None:
        super().__init__(message)
        self.transient = transient


class LLMClient:
    """Thin wrapper around Ollama's /api/chat with think disabled.

    Ollama's OpenAI-compatibility layer does not honor `think: false`,
    so this client hits /api/chat directly. base_url is accepted in
    either form (with or without a trailing /v1) for backward-compat
    with the existing .env shape.
    """

    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        root = base_url.rstrip("/")
        if root.endswith("/v1"):
            root = root[: -len("/v1")]
        self.root = root
        self.chat_url = f"{root}/api/chat"
        self.tags_url = f"{root}/api/tags"
        self.model = model
        self.client = httpx.AsyncClient(timeout=120.0)

    async def ping(self, timeout_seconds: float = 2.0) -> dict[str, object]:
        """Quick reachability check for /health. Never raises.

        Returns a dict with: reachable (bool), model_loaded (bool|None),
        error (str|None). model_loaded is None when reachable but the
        loaded-models list could not be parsed.
        """
        try:
            r = await self.client.get(self.tags_url, timeout=timeout_seconds)
            r.raise_for_status()
            data = r.json()
            models = data.get("models", []) if isinstance(data, dict) else []
            names = {m.get("name") for m in models if isinstance(m, dict)}
            return {
                "reachable": True,
                "endpoint": self.root,
                "model": self.model,
                "model_loaded": self.model in names if names else None,
                "error": None,
            }
        except Exception as exc:
            return {
                "reachable": False,
                "endpoint": self.root,
                "model": self.model,
                "model_loaded": False,
                "error": str(exc),
            }

    async def chat(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> str:
        """Send a chat request and return the response text.

        Raises ``LLMError`` on any network failure, HTTP error, or empty
        response. Callers MUST handle ``LLMError`` explicitly — empty string
        used to be the failure signal here and that spread silent garbage
        through the simulation.
        """
        started = time.monotonic()
        try:
            r = await self.client.post(
                self.chat_url,
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "stream": False,
                    "think": False,
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens,
                    },
                },
            )
        except httpx.ConnectError as exc:
            raise LLMError(f"LLM unreachable at {self.chat_url}: {exc}", transient=True) from exc
        except httpx.TimeoutException as exc:
            raise LLMError(f"LLM timed out after {time.monotonic() - started:.1f}s", transient=True) from exc
        except Exception as exc:  # network / DNS / unknown
            raise LLMError(f"LLM request failed: {type(exc).__name__}: {exc}", transient=True) from exc

        if r.status_code == 404:
            # 404 from Ollama almost always means the requested model isn't
            # loaded. Tag it as non-transient so callers can stop retrying.
            raise LLMError(
                f"LLM endpoint returned 404 — model {self.model!r} is probably not loaded.",
                transient=False,
            )
        try:
            r.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise LLMError(f"LLM HTTP {r.status_code}: {exc}", transient=True) from exc

        data = r.json()
        msg = data.get("message", {}) if isinstance(data, dict) else {}
        raw_content = msg.get("content") or msg.get("thinking") or ""
        if not raw_content:
            raise LLMError("LLM returned an empty message body.", transient=True)

        content = re.sub(r"<think>.*?</think>", "", raw_content, flags=re.DOTALL)
        content = re.sub(r"^.*?</think>", "", content, flags=re.DOTALL)
        content = content.strip()
        if not content:
            raise LLMError("LLM response was non-empty but contained only <think> tags.", transient=True)
        return content
