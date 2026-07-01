"""Web search tool using Tavily (with DuckDuckGo fallback)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from nemoclaw_reef.config import settings

logger = logging.getLogger(__name__)

# Try Tavily first, fall back to DuckDuckGo
_tavily_client = None


def _get_tavily():
    global _tavily_client
    if _tavily_client is not None:
        return _tavily_client
    api_key = settings.tavily_api_key
    if api_key:
        try:
            from tavily import TavilyClient
            _tavily_client = TavilyClient(api_key=api_key)
            logger.info("Tavily search initialized")
            return _tavily_client
        except Exception:
            logger.warning("Failed to initialize Tavily, falling back to DuckDuckGo")
    _tavily_client = False  # Mark as unavailable
    return False


async def web_search(query: str, max_results: int = 5) -> list[dict[str, Any]]:
    """Search the web and return a list of results.

    Uses Tavily if TAVILY_API_KEY is set, otherwise falls back to DuckDuckGo.
    Each result is a dict with keys ``title``, ``url``, and ``body``.
    """
    client = _get_tavily()
    if client:
        return await _tavily_search(client, query, max_results)
    return await _ddg_search(query, max_results)


async def _tavily_search(client: Any, query: str, max_results: int) -> list[dict[str, Any]]:
    """Search using Tavily API — higher quality, includes content snippets."""
    loop = asyncio.get_running_loop()

    def _search() -> list[dict[str, Any]]:
        try:
            response = client.search(
                query=query,
                max_results=max_results,
                search_depth="advanced",
                include_answer=True,
            )
            results = []
            # Include Tavily's AI-generated answer as the first result
            if response.get("answer"):
                results.append({
                    "title": "AI Summary",
                    "url": "",
                    "body": response["answer"],
                })
            for r in response.get("results", []):
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "body": r.get("content", ""),
                })
            return results[:max_results + 1]  # +1 for the AI summary
        except Exception:
            logger.exception("Tavily search failed for query: %s", query)
            return []

    return await loop.run_in_executor(None, _search)


async def _ddg_search(query: str, max_results: int) -> list[dict[str, Any]]:
    """Fallback: search using DuckDuckGo (supports both ddgs and duckduckgo_search)."""
    loop = asyncio.get_running_loop()

    def _search() -> list[dict[str, Any]]:
        # Try the new 'ddgs' package first, fall back to legacy 'duckduckgo_search'
        try:
            from ddgs import DDGS
        except ImportError:
            from duckduckgo_search import DDGS

        try:
            with DDGS() as ddgs:
                raw_results = list(ddgs.text(query, max_results=max_results))
            return [
                {
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "body": r.get("body", ""),
                }
                for r in raw_results
            ]
        except Exception:
            logger.exception("DuckDuckGo search failed for query: %s", query)
            return []

    return await loop.run_in_executor(None, _search)
