"""Async LLM client — speaks both Ollama and OpenAI-compatible APIs.

Default local setup can be Ollama (`http://host:11434/api/chat`), but users can
switch the live backend to any vLLM / OpenAI-compatible endpoint via the
model-registry UI (see ``llm/registry.py`` + ``routes/models.py``). The
client owns a single mutable configuration so swapping models doesn't
require reconstructing every Agent's ``self.llm`` reference — they all
read through this one instance, which gets reconfigured in place.
"""

from __future__ import annotations

import logging
import re
import time

import httpx

logger = logging.getLogger(__name__)


# Backend kinds the client knows how to talk to.
KIND_OLLAMA = "ollama"
KIND_OPENAI = "openai"
ALLOWED_KINDS = (KIND_OLLAMA, KIND_OPENAI)


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
    """Protocol-aware chat client. Supports Ollama native + OpenAI-compatible.

    The active configuration is mutable — ``reconfigure()`` swaps the kind,
    base_url, model, and api_key in place so the model-registry can switch
    backends at runtime without touching agents.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        kind: str = KIND_OLLAMA,
    ) -> None:
        self.client = httpx.AsyncClient(timeout=120.0)
        self._configure(base_url=base_url, api_key=api_key, model=model, kind=kind)

    def reconfigure(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        kind: str,
    ) -> None:
        """Swap to a different backend in place. Agents keep their ref."""
        self._configure(base_url=base_url, api_key=api_key, model=model, kind=kind)

    def _configure(self, *, base_url: str, api_key: str, model: str, kind: str) -> None:
        if kind not in ALLOWED_KINDS:
            raise ValueError(f"Unknown LLM kind {kind!r}; allowed: {ALLOWED_KINDS}")
        self.kind = kind
        self.api_key = api_key
        self.model = model

        root = base_url.rstrip("/")
        if kind == KIND_OPENAI:
            # Accept either http://host:port or http://host:port/v1 — most
            # vLLM/OpenAI deployments expect /v1 paths regardless.
            if root.endswith("/v1"):
                root_no_v1 = root[: -len("/v1")]
                root_v1 = root
            else:
                root_no_v1 = root
                root_v1 = f"{root}/v1"
            self.root = root_no_v1
            self.chat_url = f"{root_v1}/chat/completions"
            self.discover_url = f"{root_v1}/models"
        else:  # KIND_OLLAMA
            # Allow base_url written as either form; Ollama uses /api/* paths.
            if root.endswith("/v1"):
                root = root[: -len("/v1")]
            self.root = root
            self.chat_url = f"{root}/api/chat"
            self.discover_url = f"{root}/api/tags"

    def _auth_headers(self) -> dict[str, str]:
        if self.kind == KIND_OPENAI and self.api_key:
            return {"Authorization": f"Bearer {self.api_key}"}
        return {}

    async def _post_with_retry(
        self,
        url: str,
        payload: dict,
        post_kwargs: dict,
        headers: dict | None = None,
    ) -> httpx.Response:
        """POST with a single retry on RemoteProtocolError.

        httpx keeps connections pooled across requests. When the LLM server
        (Ollama, vLLM, etc.) closes a pooled connection on its own idle
        timer EXACTLY as we try to reuse it, httpx raises
        ``RemoteProtocolError: Server disconnected without sending a
        response.`` — but the request itself was never delivered, so a
        retry on a fresh connection is safe and almost always succeeds.

        Without this retry the user sees a transient "LLM unreachable"
        banner every time the pool hiccups, which is noisy and misleading.
        """
        send_kwargs = dict(post_kwargs)
        if headers is not None:
            send_kwargs["headers"] = headers
        try:
            return await self.client.post(url, json=payload, **send_kwargs)
        except httpx.RemoteProtocolError as exc:
            logger.info("LLM pooled connection dropped (%s); retrying once", exc)
            return await self.client.post(url, json=payload, **send_kwargs)

    async def ping(self, timeout_seconds: float = 2.0) -> dict[str, object]:
        """Quick reachability check for /health. Never raises.

        Returns a dict with: reachable (bool), model_loaded (bool|None),
        error (str|None). model_loaded is None when reachable but the
        loaded-models list could not be parsed.
        """
        try:
            r = await self.client.get(
                self.discover_url,
                timeout=timeout_seconds,
                headers=self._auth_headers(),
            )
            r.raise_for_status()
            data = r.json()
            if self.kind == KIND_OPENAI:
                # OpenAI: { "data": [ { "id": "model-name", ... } ] }
                models = data.get("data", []) if isinstance(data, dict) else []
                names = {m.get("id") for m in models if isinstance(m, dict)}
            else:
                # Ollama: { "models": [ { "name": "model:tag", ... } ] }
                models = data.get("models", []) if isinstance(data, dict) else []
                names = {m.get("name") for m in models if isinstance(m, dict)}
            return {
                "reachable": True,
                "endpoint": self.root,
                "model": self.model,
                "kind": self.kind,
                "model_loaded": self.model in names if names else None,
                "error": None,
            }
        except Exception as exc:
            return {
                "reachable": False,
                "endpoint": self.root,
                "model": self.model,
                "kind": self.kind,
                "model_loaded": False,
                "error": str(exc),
            }

    async def chat(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 1024,
        timeout: float | None = None,
    ) -> str:
        """Send a chat request and return the response text.

        Raises ``LLMError`` on any network failure, HTTP error, or empty
        response. Callers MUST handle ``LLMError`` explicitly — empty string
        used to be the failure signal here and that spread silent garbage
        through the simulation.

        ``timeout`` (seconds) overrides the client-level default for slow
        calls — primarily reef chat, which can sit through a model warmup
        on first invocation. Pass ``None`` to use the client default.
        """
        if self.kind == KIND_OPENAI:
            return await self._chat_openai(system_prompt, user_prompt, temperature, max_tokens, timeout)
        return await self._chat_ollama(system_prompt, user_prompt, temperature, max_tokens, timeout)

    async def _chat_ollama(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int,
        timeout: float | None,
    ) -> str:
        started = time.monotonic()
        post_kwargs: dict[str, object] = {}
        if timeout is not None:
            post_kwargs["timeout"] = timeout
        payload = {
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
        }
        try:
            r = await self._post_with_retry(self.chat_url, payload, post_kwargs)
        except httpx.ConnectError as exc:
            raise LLMError(f"LLM unreachable at {self.chat_url}: {exc}", transient=True) from exc
        except httpx.TimeoutException as exc:
            raise LLMError(f"LLM timed out after {time.monotonic() - started:.1f}s", transient=True) from exc
        except Exception as exc:
            raise LLMError(f"LLM request failed: {type(exc).__name__}: {exc}", transient=True) from exc

        if r.status_code == 404:
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

        return _strip_think(raw_content)

    async def _chat_openai(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int,
        timeout: float | None,
    ) -> str:
        started = time.monotonic()
        post_kwargs: dict[str, object] = {}
        if timeout is not None:
            post_kwargs["timeout"] = timeout
        headers = {"Content-Type": "application/json", **self._auth_headers()}
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
            # Mirror of the Ollama-side `think: false` knob: tells
            # reasoning-capable Qwen-style models (qwen3.6-27b-mtp on
            # vLLM, etc.) to skip the thinking phase and put the
            # answer directly in message.content. Servers that don't
            # recognise the field will ignore it; servers that DO
            # recognise it stop dumping chain-of-thought into the
            # `reasoning` field with `content:null`, which is what
            # made every agent + reef-chat call fail.
            "chat_template_kwargs": {"enable_thinking": False},
        }
        try:
            r = await self._post_with_retry(self.chat_url, payload, post_kwargs, headers=headers)
        except httpx.ConnectError as exc:
            raise LLMError(f"LLM unreachable at {self.chat_url}: {exc}", transient=True) from exc
        except httpx.TimeoutException as exc:
            raise LLMError(f"LLM timed out after {time.monotonic() - started:.1f}s", transient=True) from exc
        except Exception as exc:
            raise LLMError(f"LLM request failed: {type(exc).__name__}: {exc}", transient=True) from exc

        if r.status_code == 404:
            raise LLMError(
                f"LLM endpoint returned 404 — model {self.model!r} not served at this endpoint.",
                transient=False,
            )
        try:
            r.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise LLMError(f"LLM HTTP {r.status_code}: {exc}", transient=True) from exc

        data = r.json()
        choices = data.get("choices") if isinstance(data, dict) else None
        if not choices:
            raise LLMError("LLM response missing 'choices' array.", transient=True)
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if not isinstance(msg, dict):
            raise LLMError("LLM response missing message body.", transient=True)
        # Prefer real `content`. If it's empty/null, the model didn't actually
        # produce visible output — common with reasoning-style servers (vLLM
        # MTP, etc.) where the model used the whole token budget reasoning and
        # never emitted an answer. Treat that as a transient LLM error rather
        # than leaking the raw chain-of-thought into the UI.
        content = msg.get("content")
        if not content:
            raw_reasoning = (msg.get("reasoning") or "").strip()
            if raw_reasoning:
                raise LLMError(
                    "LLM produced reasoning but no visible content "
                    "(model exhausted token budget on chain-of-thought). "
                    "Consider lowering max_tokens, switching to a non-reasoning "
                    "model, or enabling thinking-off on the server.",
                    transient=True,
                )
            raise LLMError("LLM returned an empty message body.", transient=True)

        return _strip_think(content)


_THINKING_PROCESS_RE = re.compile(
    # Common chain-of-thought preambles that some reasoning-tuned models
    # (qwen3.6-27b-mtp on vLLM, etc.) emit before the actual answer. We
    # strip from the start of the string up to a blank line — that's the
    # conventional boundary between thinking and the visible answer.
    r"^\s*(?:Here(?:'s| is)|Okay,|Let me)?\s*"
    r"(?:a\s+)?Thinking\s*Process[:.]?.*?(?:\n\s*\n|\n[0-9]+\.)",
    re.IGNORECASE | re.DOTALL,
)


def _strip_think(raw: str) -> str:
    """Drop <think>...</think> blocks and trim. Shared between both protocols.

    Also peels off "Here's a thinking process:..." style preambles that
    reasoning-tuned servers sometimes leak into the visible channel — we
    don't want those rendered in the chat UI.
    """
    content = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)
    content = re.sub(r"^.*?</think>", "", content, flags=re.DOTALL)
    content = _THINKING_PROCESS_RE.sub("", content, count=1)
    content = content.strip()
    if not content:
        raise LLMError("LLM response was non-empty but contained only <think> tags.", transient=True)
    return content
