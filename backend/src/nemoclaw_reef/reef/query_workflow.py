"""Query intake — turns user queries into a coordinated reef-commons workflow.

Owns the lifecycle of a "general" prompt (the one the user types in the input
box, not a sandbox task): pulling it off the queue, parking the free lobsters
in the war room, broadcasting the kickoff events, and cleanly finishing when
Pearl writes the whiteboard.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Awaitable, Callable

from nemoclaw_reef.agents.base import Agent
from nemoclaw_reef.models import AgentState, ReefEvent
from nemoclaw_reef.state.layout import get_room_position, release_room_seat
from nemoclaw_reef.state.reef_state import ReefState

logger = logging.getLogger(__name__)


BroadcastFn = Callable[[dict[str, Any]], Awaitable[None]]
FullStateFn = Callable[[], Awaitable[None]]
ReservedAgentNamesFn = Callable[[], set[str]]


class QueryIntake:
    """Drains the user-query queue and prepares the reef commons for collaboration."""

    def __init__(
        self,
        *,
        agents: list[Agent],
        reef_state: ReefState,
        query_queue: asyncio.Queue[dict[str, Any]],
        active_sandbox_agent_names: ReservedAgentNamesFn,
        assigned_sandbox_agent_names: ReservedAgentNamesFn,
        broadcast: BroadcastFn,
        broadcast_full_state: FullStateFn,
    ) -> None:
        self._agents = agents
        self._reef_state = reef_state
        self._queue = query_queue
        self._active_sandbox_agents = active_sandbox_agent_names
        self._assigned_sandbox_agents = assigned_sandbox_agent_names
        self._broadcast = broadcast
        self._broadcast_full_state = broadcast_full_state

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def drain(self) -> None:
        """Pull every pending query off the queue and set up the reef commons."""

        while True:
            try:
                query_data = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            await self._process_one(query_data)

    def finish_general_query(self) -> None:
        """Clear general-query state without disturbing sandbox-reserved agents.

        Called from the tick loop when Pearl writes the whiteboard.
        """

        self._reef_state.current_query = None
        self._reef_state.current_files = []
        reserved = self._active_sandbox_agents() | self._assigned_sandbox_agents()
        for agent in self._agents:
            if agent.name in reserved:
                continue
            agent.current_task = None
            agent.state = AgentState.idle
            state = self._reef_state.agent_states.setdefault(agent.name, {})
            state["state"] = AgentState.idle.value
            state["current_task"] = None
            state["sandbox_name"] = agent.sandbox_name
            state["connect_command"] = agent.connect_command

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _process_one(self, query_data: dict[str, Any]) -> None:
        query_text = query_data["query"]
        files = query_data.get("files", [])

        self._reef_state.current_query = query_text
        self._reef_state.current_files = files

        reserved = self._active_sandbox_agents() | self._assigned_sandbox_agents()
        available = [a for a in self._agents if a.name not in reserved]

        if not available:
            # Every lobster is sandbox-bound — nothing left for the reef commons.
            self.finish_general_query()
            content = (
                "所有爪子目前都被分配到 NemoClaw 沙盒里，所以 reef commons 没有空闲团队处理这个通用提示。"
                if self._reef_state.speech_language == "zh"
                else "All claws are currently assigned to NemoClaw sandboxes, so the reef commons has no free team for this general prompt."
            )
            await self._broadcast({
                "type": "agent_action",
                "agent": "Captain Claw",
                "role": "lead",
                "action": "announce",
                "content": content,
                "target": "all",
                "reasoning": "General prompt has no free OpenClaw profiles",
                "state": "idle",
                "location": "war_room",
                "position": {"x": 168, "y": 432},
                "timestamp": datetime.now().isoformat(),
            })
            await self._broadcast({
                "type": "query_completed",
                "query": query_text,
                "status": "no_free_agents",
                "timestamp": datetime.now().isoformat(),
            })
            await self._broadcast_full_state()
            return

        if reserved:
            busy_names = ", ".join(sorted(reserved))
            content = (
                f"通用提示已接收。已分配到沙盒的爪子会留在原位：{busy_names}。"
                if self._reef_state.speech_language == "zh"
                else f"General prompt accepted. Sandbox-assigned claws stay in place: {busy_names}."
            )
            await self._broadcast({
                "type": "agent_action",
                "agent": "Captain Claw",
                "role": "lead",
                "action": "announce",
                "content": content,
                "target": "all",
                "reasoning": "Sandbox teams are isolated from general war-room prompts",
                "state": "idle",
                "location": "war_room",
                "position": {"x": 168, "y": 432},
                "timestamp": datetime.now().isoformat(),
            })

        # Move free agents to the war room.
        for agent in available:
            release_room_seat(agent.location, agent.name)
            agent.position = get_room_position("war_room", agent.name)
            agent.location = "war_room"
            agent.state = AgentState.collaborating
            agent.current_task = query_text
            self._reef_state.update_agent_position(agent.name, agent.location, agent.position)
            state = self._reef_state.agent_states.setdefault(agent.name, {})
            state["state"] = AgentState.collaborating.value
            state["current_task"] = query_text
            state["sandbox_name"] = agent.sandbox_name
            state["connect_command"] = agent.connect_command

        # Let every available agent observe the new query so role-specific
        # workflows can branch on it.
        event = ReefEvent(
            type="new_query",
            agent="user",
            data={"query": query_text, "files": files},
            timestamp=datetime.now(),
        )
        for agent in available:
            agent.observe(event)

        await self._broadcast({
            "type": "query_received",
            "query": query_text,
            "files": files,
            "timestamp": datetime.now().isoformat(),
        })
        await self._broadcast_full_state()
        logger.info(
            "New query distributed to %d available agents (%d sandbox-reserved): %s",
            len(available),
            len(reserved),
            query_text[:80],
        )
