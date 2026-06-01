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
            await db.execute("""
                CREATE TABLE IF NOT EXISTS visitor_agents (
                    name TEXT PRIMARY KEY,
                    species TEXT NOT NULL,
                    runtime TEXT NOT NULL,
                    archetype TEXT NOT NULL,
                    role TEXT NOT NULL,
                    color TEXT,
                    appearance_json TEXT,
                    skills_json TEXT NOT NULL,
                    mission TEXT,
                    profile_json TEXT NOT NULL,
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

    async def clear_display_overrides(self) -> int:
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute("DELETE FROM sandbox_display_names")
            await db.commit()
            return cursor.rowcount if cursor.rowcount is not None else 0

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

    async def clear_user_sandbox_workspaces(self) -> int:
        """Remove dynamic app workspace registrations.

        This does not destroy live NemoClaw/OpenShell sandboxes on the host; it
        only returns the UI registry to the four starter workspaces.
        """
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "DELETE FROM sandbox_workspaces WHERE source != 'default'"
            )
            await db.commit()
            return cursor.rowcount if cursor.rowcount is not None else 0

    async def save_visitor_agent(
        self,
        *,
        name: str,
        species: str,
        runtime: str,
        archetype: str,
        role: str,
        color: str | None,
        appearance: dict[str, Any] | None,
        skills: list[str],
        mission: str | None,
        profile: dict[str, Any],
    ) -> None:
        """Persist one visitor-built agent for later export."""
        import json

        ts = datetime.now().isoformat()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT INTO visitor_agents "
                "(name, species, runtime, archetype, role, color, appearance_json, "
                "skills_json, mission, profile_json, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(name) DO UPDATE SET "
                "species=excluded.species, runtime=excluded.runtime, archetype=excluded.archetype, "
                "role=excluded.role, color=excluded.color, appearance_json=excluded.appearance_json, "
                "skills_json=excluded.skills_json, mission=excluded.mission, "
                "profile_json=excluded.profile_json, updated_at=excluded.updated_at",
                (
                    name,
                    species,
                    runtime,
                    archetype,
                    role,
                    color,
                    json.dumps(appearance or {}, sort_keys=True),
                    json.dumps(skills, sort_keys=True),
                    mission,
                    json.dumps(profile, sort_keys=True),
                    ts,
                    ts,
                ),
            )
            await db.commit()

    async def get_visitor_agent(self, name: str) -> dict[str, Any] | None:
        import json

        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM visitor_agents WHERE name = ?",
                (name,),
            )
            row = await cursor.fetchone()
        if row is None:
            return None
        return {
            "name": row["name"],
            "species": row["species"],
            "runtime": row["runtime"],
            "archetype": row["archetype"],
            "role": row["role"],
            "color": row["color"],
            "appearance": json.loads(row["appearance_json"] or "{}"),
            "skills": json.loads(row["skills_json"] or "[]"),
            "mission": row["mission"],
            "profile": json.loads(row["profile_json"] or "{}"),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    async def list_visitor_agents(self) -> list[dict[str, Any]]:
        import json

        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM visitor_agents ORDER BY created_at ASC"
            )
            rows = await cursor.fetchall()
        return [
            {
                "name": row["name"],
                "species": row["species"],
                "runtime": row["runtime"],
                "archetype": row["archetype"],
                "role": row["role"],
                "color": row["color"],
                "appearance": json.loads(row["appearance_json"] or "{}"),
                "skills": json.loads(row["skills_json"] or "[]"),
                "mission": row["mission"],
                "profile": json.loads(row["profile_json"] or "{}"),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]

    async def delete_visitor_agent(self, name: str) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("DELETE FROM visitor_agents WHERE name = ?", (name,))
            await db.commit()

    async def clear_visitor_agents(self) -> int:
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute("DELETE FROM visitor_agents")
            await db.commit()
            return cursor.rowcount if cursor.rowcount is not None else 0

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
