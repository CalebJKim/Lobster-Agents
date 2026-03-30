"""Shared mutable office state visible to all agents."""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from office_agents.models import Action, ActionType, AgentState, Position
from office_agents.office.store import PersistentStore


class OfficeState:
    """Central store for everything that is happening in the office."""

    def __init__(self, store: PersistentStore | None = None) -> None:
        self.bulletin_posts: list[dict[str, Any]] = []
        self.whiteboard: list[dict[str, Any]] = []
        self.current_query: str | None = None
        self.current_files: list[str] = []
        self.agent_states: dict[str, dict[str, Any]] = {}
        self._store = store

    async def load_history(self) -> None:
        """Load persisted deliverables and bulletin posts from SQLite."""
        if not self._store:
            return
        # Load past deliverables into bulletin as archived entries
        deliverables = await self._store.get_deliverables(limit=50)
        for d in deliverables:
            self.bulletin_posts.append({
                "agent": d["agent"],
                "content": f"**Query:** {d['query']}\n\n{d['content']}",
                "category": "deliverable",
                "timestamp": d["timestamp"],
            })
        # Load past bulletin posts
        posts = await self._store.get_bulletin_posts(limit=50)
        for p in posts:
            self.bulletin_posts.append({
                "agent": p["agent"],
                "content": p["content"],
                "category": p.get("category", "finding"),
                "timestamp": p["timestamp"],
            })
        # Sort by timestamp
        self.bulletin_posts.sort(key=lambda x: x.get("timestamp", ""))

    # ------------------------------------------------------------------
    # Mutation helpers
    # ------------------------------------------------------------------

    def register_agent(
        self,
        name: str,
        role: str,
        location: str,
        position: tuple[int, int],
    ) -> None:
        self.agent_states[name] = {
            "role": role,
            "state": AgentState.idle.value,
            "location": location,
            "position": {"x": position[0], "y": position[1]},
            "current_task": None,
        }

    def update_agent_position(
        self, agent_name: str, location: str, position: tuple[int, int]
    ) -> None:
        """Update an agent's location and position (used by water cooler moves)."""
        info = self.agent_states.get(agent_name, {})
        info["location"] = location
        info["position"] = {"x": position[0], "y": position[1]}
        self.agent_states[agent_name] = info

    def update_from_action(
        self,
        agent_name: str,
        action: Action,
        *,
        new_location: str | None = None,
        new_position: tuple[int, int] | None = None,
    ) -> None:
        """Apply the side-effects of *action* to the shared state."""
        info = self.agent_states.get(agent_name, {})

        # Map action types to visible agent states
        state_map: dict[ActionType, AgentState] = {
            ActionType.research: AgentState.researching,
            ActionType.code: AgentState.coding,
            ActionType.think: AgentState.thinking,
            ActionType.speak: AgentState.collaborating,
            ActionType.announce: AgentState.presenting,
            ActionType.move_to: AgentState.walking,
            ActionType.idle: AgentState.idle,
            ActionType.read_file: AgentState.researching,
            ActionType.post_bulletin: AgentState.collaborating,
            ActionType.write_whiteboard: AgentState.collaborating,
        }
        info["state"] = state_map.get(action.type, AgentState.idle).value

        if new_location:
            info["location"] = new_location
        if new_position:
            info["position"] = {"x": new_position[0], "y": new_position[1]}

        ts = datetime.now().isoformat()

        if action.type == ActionType.post_bulletin:
            self.bulletin_posts.append({
                "agent": agent_name,
                "content": action.content,
                "category": "finding",
                "timestamp": ts,
            })
            # Persist
            if self._store:
                asyncio.ensure_future(
                    self._store.save_bulletin_post(agent_name, action.content, "finding")
                )

        if action.type == ActionType.write_whiteboard:
            self.whiteboard.append({
                "agent": agent_name,
                "content": action.content,
                "timestamp": ts,
            })
            # Also archive to bulletin board with the query
            query = self.current_query or "Unknown query"
            self.bulletin_posts.append({
                "agent": agent_name,
                "content": f"**Query:** {query}\n\n{action.content}",
                "category": "deliverable",
                "timestamp": ts,
            })
            # Persist
            if self._store:
                asyncio.ensure_future(
                    self._store.save_deliverable(query, agent_name, action.content)
                )

        self.agent_states[agent_name] = info

    # ------------------------------------------------------------------
    # Read helpers
    # ------------------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        return {
            "current_query": self.current_query,
            "current_files": self.current_files,
            "agents": self.agent_states,
            "bulletin_posts": self.bulletin_posts[-50:],
            "whiteboard": self.whiteboard[-20:],
        }

    def get_summary(self) -> str:
        """Human-readable summary suitable for injecting into agent prompts."""
        lines: list[str] = []
        if self.current_query:
            lines.append(f"Current query from user: {self.current_query}")
        if self.current_files:
            lines.append(f"Files provided: {', '.join(self.current_files)}")

        lines.append("")
        lines.append("Agent locations:")
        for name, info in self.agent_states.items():
            task = info.get("current_task") or "none"
            lines.append(
                f"  - {name} ({info.get('role', '?')}): {info.get('state', '?')} "
                f"at {info.get('location', '?')} | task: {task}"
            )

        if self.bulletin_posts:
            lines.append("")
            lines.append("Recent bulletin posts:")
            for post in self.bulletin_posts[-5:]:
                lines.append(f"  [{post['agent']}]: {post['content'][:100]}")

        if self.whiteboard:
            lines.append("")
            lines.append("Whiteboard:")
            for entry in self.whiteboard[-3:]:
                lines.append(f"  [{entry['agent']}]: {entry['content'][:100]}")

        return "\n".join(lines)
