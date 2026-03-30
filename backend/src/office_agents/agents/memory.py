"""SQLite-backed memory system for agents."""

from __future__ import annotations

from datetime import datetime

import aiosqlite


class AgentMemory:
    """Per-agent short-term and long-term memory backed by SQLite."""

    def __init__(self, agent_name: str, db_path: str) -> None:
        self.agent_name = agent_name
        self.db_path = db_path

    async def init_db(self) -> None:
        """Create memory tables if they don't already exist."""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS short_term_memory (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    agent_name TEXT NOT NULL,
                    event TEXT NOT NULL,
                    timestamp TEXT NOT NULL
                )
                """
            )
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS long_term_memory (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    agent_name TEXT NOT NULL,
                    content TEXT NOT NULL,
                    category TEXT NOT NULL,
                    timestamp TEXT NOT NULL
                )
                """
            )
            await db.commit()

    # ------------------------------------------------------------------
    # Short-term memory (recent events the agent witnessed)
    # ------------------------------------------------------------------

    async def add_short_term(self, event: str, timestamp: datetime) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT INTO short_term_memory (agent_name, event, timestamp) VALUES (?, ?, ?)",
                (self.agent_name, event, timestamp.isoformat()),
            )
            await db.commit()

    async def get_recent(self, limit: int = 20) -> list[str]:
        """Return the last *limit* short-term events for this agent."""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT event FROM short_term_memory "
                "WHERE agent_name = ? ORDER BY id DESC LIMIT ?",
                (self.agent_name, limit),
            )
            rows = await cursor.fetchall()
            # Return in chronological order (oldest first)
            return [row["event"] for row in reversed(rows)]

    # ------------------------------------------------------------------
    # Long-term memory (findings, opinions, relationship notes)
    # ------------------------------------------------------------------

    async def add_long_term(self, content: str, category: str) -> None:
        """Store a long-term memory.

        *category* should be one of: ``finding``, ``opinion``, ``relationship``.
        """
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT INTO long_term_memory (agent_name, content, category, timestamp) "
                "VALUES (?, ?, ?, ?)",
                (self.agent_name, content, category, datetime.now().isoformat()),
            )
            await db.commit()

    async def search_long_term(self, query: str, limit: int = 5) -> list[str]:
        """Simple keyword search across long-term memories.

        Splits *query* into words and matches rows containing any of them.
        """
        words = [w.strip().lower() for w in query.split() if len(w.strip()) > 2]
        if not words:
            return []

        # Build a WHERE clause that matches any keyword
        conditions = " OR ".join(["LOWER(content) LIKE ?"] * len(words))
        params: list[str] = [f"%{w}%" for w in words]
        params.append(self.agent_name)

        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                f"SELECT content FROM long_term_memory "
                f"WHERE ({conditions}) AND agent_name = ? "
                f"ORDER BY id DESC LIMIT ?",
                (*params, limit),
            )
            rows = await cursor.fetchall()
            return [row["content"] for row in rows]

    async def get_all_findings(self) -> list[str]:
        """Return every long-term memory tagged as a *finding*."""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT content FROM long_term_memory "
                "WHERE agent_name = ? AND category = 'finding' ORDER BY id",
                (self.agent_name,),
            )
            rows = await cursor.fetchall()
            return [row["content"] for row in rows]
