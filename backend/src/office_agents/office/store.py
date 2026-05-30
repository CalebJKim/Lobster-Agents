"""Persistent storage for deliverables and bulletin posts (SQLite)."""

from __future__ import annotations

import aiosqlite
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


class PersistentStore:
    """SQLite-backed storage for whiteboard deliverables and bulletin posts."""

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path

    async def init_db(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS deliverables (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    query TEXT NOT NULL,
                    agent TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp TEXT NOT NULL
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS bulletin_posts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    agent TEXT NOT NULL,
                    content TEXT NOT NULL,
                    category TEXT NOT NULL DEFAULT 'finding',
                    timestamp TEXT NOT NULL
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS sandbox_display_names (
                    sandbox_name TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS sandbox_workspaces (
                    sandbox_name TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    home_room TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT 'user',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            await db.commit()
        logger.info("Persistent store initialized at %s", self.db_path)

    async def get_display_overrides(self) -> dict[str, str]:
        """User-defined display names that win over claw_config defaults."""
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "SELECT sandbox_name, display_name FROM sandbox_display_names"
            )
            rows = await cursor.fetchall()
        return {row[0]: row[1] for row in rows}

    async def set_display_override(self, sandbox_name: str, display_name: str) -> None:
        """Upsert one sandbox's display name. Caller validates the names."""
        ts = datetime.now().isoformat()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT INTO sandbox_display_names (sandbox_name, display_name, updated_at) "
                "VALUES (?, ?, ?) "
                "ON CONFLICT(sandbox_name) DO UPDATE SET display_name=excluded.display_name, "
                "updated_at=excluded.updated_at",
                (sandbox_name, display_name, ts),
            )
            await db.commit()
        logger.info("Sandbox %s renamed to %r", sandbox_name, display_name)

    async def clear_display_override(self, sandbox_name: str) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "DELETE FROM sandbox_display_names WHERE sandbox_name = ?",
                (sandbox_name,),
            )
            await db.commit()

    async def list_sandbox_workspaces(self) -> list[dict[str, Any]]:
        """User-created sandbox workspaces persisted across backend restarts."""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT sandbox_name, display_name, home_room, source, created_at, updated_at "
                "FROM sandbox_workspaces ORDER BY created_at ASC"
            )
            rows = await cursor.fetchall()
        return [
            {
                "sandbox_name": row["sandbox_name"],
                "display_name": row["display_name"],
                "home_room": row["home_room"],
                "source": row["source"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]

    async def add_sandbox_workspace(
        self,
        *,
        sandbox_name: str,
        display_name: str,
        home_room: str,
        source: str = "user",
    ) -> None:
        """Persist one dynamic NemoClaw workspace."""
        ts = datetime.now().isoformat()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT INTO sandbox_workspaces "
                "(sandbox_name, display_name, home_room, source, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(sandbox_name) DO UPDATE SET "
                "display_name=excluded.display_name, "
                "home_room=excluded.home_room, "
                "source=excluded.source, "
                "updated_at=excluded.updated_at",
                (sandbox_name, display_name, home_room, source, ts, ts),
            )
            await db.commit()
        logger.info("Registered sandbox workspace %s (%s)", sandbox_name, display_name)

    async def save_deliverable(
        self, query: str, agent: str, content: str
    ) -> int:
        """Save a whiteboard deliverable. Returns the row ID."""
        ts = datetime.now().isoformat()
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "INSERT INTO deliverables (query, agent, content, timestamp) VALUES (?, ?, ?, ?)",
                (query, agent, content, ts),
            )
            await db.commit()
            row_id = cursor.lastrowid or 0
        logger.info("Saved deliverable #%d for query: %s", row_id, query[:60])
        return row_id

    async def save_bulletin_post(
        self, agent: str, content: str, category: str = "finding"
    ) -> int:
        """Save a bulletin board post. Returns the row ID."""
        ts = datetime.now().isoformat()
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "INSERT INTO bulletin_posts (agent, content, category, timestamp) VALUES (?, ?, ?, ?)",
                (agent, content, category, ts),
            )
            await db.commit()
            return cursor.lastrowid or 0

    async def get_deliverables(self, limit: int = 50) -> list[dict[str, Any]]:
        """Get recent deliverables, newest first."""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT id, query, agent, content, timestamp FROM deliverables "
                "ORDER BY id DESC LIMIT ?",
                (limit,),
            )
            rows = await cursor.fetchall()
        return [
            {
                "id": r["id"],
                "query": r["query"],
                "agent": r["agent"],
                "content": r["content"],
                "timestamp": r["timestamp"],
            }
            for r in reversed(rows)  # oldest first for display
        ]

    async def get_bulletin_posts(self, limit: int = 50) -> list[dict[str, Any]]:
        """Get recent bulletin posts, newest first."""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT id, agent, content, category, timestamp FROM bulletin_posts "
                "ORDER BY id DESC LIMIT ?",
                (limit,),
            )
            rows = await cursor.fetchall()
        return [
            {
                "id": r["id"],
                "agent": r["agent"],
                "content": r["content"],
                "category": r["category"],
                "timestamp": r["timestamp"],
            }
            for r in reversed(rows)
        ]
