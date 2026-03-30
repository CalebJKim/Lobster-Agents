"""Async OpenAI-compatible LLM client."""

from __future__ import annotations

import logging
import re

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


class LLMClient:
    """Thin wrapper around the async OpenAI client for chat completions."""

    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        self.client = AsyncOpenAI(base_url=base_url, api_key=api_key)
        self.model = model

    async def chat(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> str:
        """Send a chat completion request and return the response text.

        Returns an empty string if the request fails so callers can
        degrade gracefully.
        """
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
            )
            msg = response.choices[0].message
            raw_content = msg.content or ""
            # Some reasoning models put the real content in reasoning_content
            if not raw_content and hasattr(msg, "reasoning_content") and msg.reasoning_content:
                raw_content = msg.reasoning_content
            # Log empty responses for debugging
            if not raw_content:
                # Dump all available fields
                fields = {k: str(v)[:100] for k, v in msg.__dict__.items() if v}
                logger.warning("LLM returned empty content. Message fields: %s", fields)
            # Strip thinking traces from reasoning models
            # Handle: <think>...</think>, or text...</think> (missing open tag)
            content = re.sub(r"<think>.*?</think>", "", raw_content, flags=re.DOTALL)
            content = re.sub(r"^.*?</think>", "", content, flags=re.DOTALL)
            content = content.strip()
            # If stripping think blocks left nothing, extract from inside the block
            if not content and "<think>" in raw_content:
                think_match = re.search(r"<think>(.*?)</think>", raw_content, re.DOTALL)
                if think_match:
                    content = think_match.group(1).strip()
            return content
        except Exception:
            logger.exception("LLM request failed")
            return ""
