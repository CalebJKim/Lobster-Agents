"""WebSocket connection manager + broadcaster.

One place that owns the list of connected clients and the fanout. Routes and
the orchestrator only see `broadcaster.broadcast(payload)` — they never touch
WebSocket objects directly.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class Broadcaster:
    """Tracks active WebSocket clients and fans messages out to all of them."""

    def __init__(self) -> None:
        self._connections: list[WebSocket] = []

    @property
    def client_count(self) -> int:
        return len(self._connections)

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.append(ws)
        logger.info("WebSocket connected (%d total)", len(self._connections))

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self._connections:
            self._connections.remove(ws)
            logger.info("WebSocket disconnected (%d remaining)", len(self._connections))

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Send a JSON message to every connected client. Drops dead sockets."""
        dead: list[WebSocket] = []
        for ws in self._connections:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)
