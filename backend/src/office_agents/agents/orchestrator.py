"""Simulation tick loop — drives all agents and broadcasts events."""

from __future__ import annotations

import asyncio
import logging
import random
import re
from datetime import datetime
from typing import Any, Callable, Coroutine
from uuid import uuid4

from office_agents.agents.base import Agent
from office_agents.config import settings
from office_agents.models import Action, ActionType, AgentState, OfficeEvent
from office_agents.office.layout import get_room_position, release_room_seat
from office_agents.office.state import OfficeState
from office_agents.reef import IdleChat, QueryIntake
from office_agents.sandbox_runtime.manager import SandboxManager, short_sandbox_name

logger = logging.getLogger(__name__)


class Orchestrator:
    """Runs the agent simulation in a continuous tick loop."""

    def __init__(
        self,
        agents: list[Agent],
        office_state: OfficeState,
        broadcast: Callable[[dict[str, Any]], Coroutine[Any, Any, None]],
    ) -> None:
        self.agents = agents
        self.office_state = office_state
        self.broadcast = broadcast
        self.running = False
        self.query_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._tick_count = 0
        self._query_tick = 0  # ticks since current query started
        self._query_event = asyncio.Event()  # fires when a new query arrives
        self.water_cooler_enabled = True  # toggle idle chat
        self.water_cooler_topic: str | None = None  # forced topic (None = random)
        self.sandboxes = SandboxManager(
            agents=agents,
            office_state=office_state,
            broadcast=broadcast,
            broadcast_full_state=self._broadcast_full_state,
        )
        self._idle_chat = IdleChat(
            agents=agents,
            office_state=office_state,
            sandbox_assignments=self.sandboxes.assignments,
            broadcast=broadcast,
            query_event=self._query_event,
        )
        self._query_intake = QueryIntake(
            agents=agents,
            office_state=office_state,
            query_queue=self.query_queue,
            active_sandbox_agent_names=self.sandboxes.active_agent_names,
            assigned_sandbox_agent_names=self.sandboxes.assigned_agent_names,
            broadcast=broadcast,
            broadcast_full_state=self._broadcast_full_state,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def submit_query(
        self, query: str, files: list[str] | None = None
    ) -> None:
        """User submits a new question for the office to work on."""
        await self.query_queue.put({"query": query, "files": files or []})
        self._query_event.set()  # wake up the run loop immediately

    async def submit_reply(self, reply: str) -> None:
        """User replies to a question from an agent (e.g., Captain Claw's ask_user)."""
        event = OfficeEvent(
            type="user_reply",
            agent="user",
            data={"message": reply},
            timestamp=datetime.now(),
        )
        for agent in self.agents:
            agent.observe(event)
        # Broadcast to frontend
        await self.broadcast({
            "type": "agent_action",
            "agent": "User",
            "role": "user",
            "action": "speak",
            "content": reply,
            "target": "all",
            "reasoning": "User reply",
            "state": "idle",
            "location": "war_room",
            "position": {"x": 168, "y": 432},
            "timestamp": datetime.now().isoformat(),
        })

    # ------------------------------------------------------------------
    # Sandbox API — thin delegations to self.sandboxes (SandboxManager).
    # Kept on Orchestrator so the existing main.py call sites don't change.
    # ------------------------------------------------------------------

    @property
    def sandbox_assignments(self) -> dict[str, list[str]]:
        """Live reference to the manager's assignment table (used by reef chat)."""
        return self.sandboxes.assignments

    def get_sandbox_assignments(self) -> dict[str, list[str]]:
        return self.sandboxes.get_assignments()

    def get_sandbox_run_statuses(self) -> dict[str, dict[str, Any]]:
        return self.sandboxes.get_run_statuses()

    def _active_sandbox_agent_names(self) -> set[str]:
        return self.sandboxes.active_agent_names()

    def _active_sandbox_names(self) -> set[str]:
        return self.sandboxes.active_sandbox_names()

    def _assigned_sandbox_agent_names(self) -> set[str]:
        return self.sandboxes.assigned_agent_names()

    def _general_query_role_names(self, available_agents: list[Agent]) -> tuple[str | None, str | None]:
        """Pick free lead/writer roles for general prompts."""

        if not available_agents:
            return None, None

        by_name = {agent.name: agent for agent in available_agents}
        lead = by_name.get("Captain Claw") or available_agents[0]
        writer = by_name.get("Pearl")
        if writer is None:
            writer = next((agent for agent in available_agents if agent.role == "writer"), None)
        if writer is None:
            writer = next((agent for agent in available_agents if agent.role in {"lead", "planner", "critic"}), None)
        if writer is None:
            writer = available_agents[-1]
        return lead.name, writer.name

    async def cancel_all_sandbox_runs(self, reason: str = "reset") -> None:
        await self.sandboxes.cancel_all_runs(reason)

    def clear_sandbox_run_statuses(self) -> None:
        self.sandboxes.clear_run_statuses()

    async def assign_sandbox_team(
        self,
        sandbox_name: str,
        agent_names: list[str],
    ) -> dict[str, list[str]]:
        return await self.sandboxes.assign_team(sandbox_name, agent_names)

    async def run_sandbox_team_task(
        self,
        sandbox_name: str,
        task: str,
        agent_names: list[str] | None = None,
    ) -> str:
        return await self.sandboxes.run_team_task(sandbox_name, task, agent_names)

    async def cancel_sandbox_team_task(
        self,
        sandbox_name: str,
        run_id: str,
    ) -> dict[str, Any]:
        return await self.sandboxes.cancel_team_task(sandbox_name, run_id)

    async def run(self) -> None:
        """Main simulation loop — call as a background task."""
        self.running = True
        logger.info("Orchestrator started")

        while self.running:
            try:
                await self._tick()
            except Exception:
                logger.exception("Error during simulation tick")

            # Short sleep when actively working, longer when idle.
            # Use _query_event to wake up INSTANTLY when a user query arrives
            # instead of sleeping through a full idle tick interval.
            if self.office_state.current_query:
                await asyncio.sleep(0.5)  # Fast ticks during active query
            else:
                # Idle: short pause then next reef chat tick.
                # Wake instantly if a query arrives.
                self._query_event.clear()
                try:
                    await asyncio.wait_for(self._query_event.wait(), timeout=1.0)
                    logger.info("Query arrived — waking up immediately")
                except asyncio.TimeoutError:
                    pass

        logger.info("Orchestrator stopped")

    def stop(self) -> None:
        self.running = False

    # ------------------------------------------------------------------
    # Internal tick logic
    # ------------------------------------------------------------------

    async def _tick(self) -> None:
        self._tick_count += 1

        # Track query duration
        if self.office_state.current_query:
            self._query_tick += 1
        else:
            self._query_tick = 0

        # 1. Drain any pending user queries
        await self._process_query_queue()

        # 1b. Inject idle behaviour nudges when no active query
        await self._inject_idle_behavior()

        # 1c. Check again — a query may have arrived during the idle LLM call
        if not self.query_queue.empty():
            await self._process_query_queue()

        # 1d. If query has been active too long, push convergence
        await self._inject_convergence_pressure()

        # 2. Run agent think-act cycles
        #    During active queries, skip agents who won't contribute (Snips, Reefus)
        #    to reduce tick time. Run independent agents in PARALLEL for speed.
        #    During IDLE with reef chat: skip agent LLM calls entirely.
        #    The reef chat function already generates chatter.
        if not self.office_state.current_query:
            # Idle — reef chat handles everything, no agent LLM calls needed.
            if self._tick_count % 5 == 0:
                await self._broadcast_full_state()
            return

        active_sandbox_agents = self._active_sandbox_agent_names()
        assigned_sandbox_agents = self._assigned_sandbox_agent_names()
        reserved_sandbox_agents = active_sandbox_agents | assigned_sandbox_agents
        active_agents = [
            agent for agent in self.agents
            if agent.name not in reserved_sandbox_agents
        ]
        if not active_agents:
            if self._tick_count % 5 == 0:
                await self._broadcast_full_state()
            return

        if self._query_tick >= 2:
            essential = {"Clawdia", "Shelldon", "Coraline", "Pearl", "Captain Claw"}
            active_agents = [a for a in self.agents if a.name in essential]
            active_agents = [a for a in active_agents if a.name not in reserved_sandbox_agents]
            if not active_agents:
                if self._tick_count % 5 == 0:
                    await self._broadcast_full_state()
                return

        participant_names = {agent.name for agent in active_agents}
        general_lead, general_writer = self._general_query_role_names(active_agents)

        # Group agents into parallel batches:
        # Batch 1: Captain Claw (coordinator) — runs first to set direction
        # Batch 2: Clawdia, Coraline (researchers) — can run in parallel
        # Batch 3: Shelldon, Reefus, Snips (analyzers/supporters) — can run in parallel
        # Batch 4: Pearl (writer) — runs last to synthesize
        _BATCH_ORDER = {"Captain Claw": 0, "Clawdia": 1, "Coraline": 1, "Shelldon": 2, "Reefus": 2, "Snips": 2, "Pearl": 3}

        batches: dict[int, list[Agent]] = {}
        for agent in active_agents:
            batch = _BATCH_ORDER.get(agent.name, 2)
            batches.setdefault(batch, []).append(agent)

        for batch_idx in sorted(batches.keys()):
            batch_agents = batches[batch_idx]

            # If a query just arrived while we're processing idle agents,
            # bail out early so the next tick can start the query immediately
            if not self.office_state.current_query and not self.query_queue.empty():
                logger.info("Query waiting — aborting idle tick early")
                break

            # Broadcast "thinking" status so the frontend knows who's processing
            if self.office_state.current_query:
                names = [a.name for a in batch_agents]
                await self.broadcast({
                    "type": "agents_thinking",
                    "agents": names,
                    "timestamp": datetime.now().isoformat(),
                })

            # Build shared state snapshot once per batch
            state = self.office_state.to_dict()
            state["query_tick"] = self._query_tick
            state["general_query_lead"] = general_lead
            state["general_query_writer"] = general_writer
            state["agents"] = {
                name: info
                for name, info in state.get("agents", {}).items()
                if name in participant_names
            }

            async def _run_agent(agent: Agent) -> tuple[Agent, Action, dict] | None:
                try:
                    action = await agent.think(state)
                    result = await agent.execute(action)
                    return (agent, action, result)
                except Exception:
                    logger.exception(
                        "Error processing agent %s on tick %d",
                        agent.name, self._tick_count,
                    )
                    return None

            # Run batch agents concurrently
            if len(batch_agents) > 1:
                outcomes = await asyncio.gather(*[_run_agent(a) for a in batch_agents])
            else:
                outcomes = [await _run_agent(batch_agents[0])]

            # Process results sequentially (event broadcasting must be ordered)
            for outcome in outcomes:
                if outcome is None:
                    continue
                agent, action, result = outcome

                event = self._action_to_event(agent, action, result)
                for other in self.agents:
                    if other.name != agent.name and other.name in participant_names:
                        other.observe(event)

                await self._broadcast_action(agent, action, result)

                if "auto_share" in result:
                    share_event = OfficeEvent(
                        type="speak",
                        agent=agent.name,
                        data={"message": result["auto_share"], "target": "all"},
                        timestamp=datetime.now(),
                    )
                    for other in self.agents:
                        if other.name != agent.name and other.name in participant_names:
                            other.observe(share_event)
                    await self.broadcast({
                        "type": "agent_action",
                        "agent": agent.name,
                        "role": agent.role,
                        "action": "speak",
                        "content": result["auto_share"],
                        "target": "all",
                        "reasoning": "Sharing research findings",
                        "state": agent.state.value,
                        "location": agent.location,
                        "position": {"x": agent.position[0], "y": agent.position[1]},
                        "timestamp": datetime.now().isoformat(),
                    })

                self.office_state.update_from_action(
                    agent.name,
                    action,
                    new_location=agent.location,
                    new_position=agent.position,
                )

                if action.type == ActionType.write_whiteboard and self.office_state.current_query:
                    query_text = self.office_state.current_query
                    self._finish_general_query_state()

                    await self.broadcast({
                        "type": "agent_action",
                        "agent": "Captain Claw",
                        "role": "lead",
                        "action": "speak",
                        "content": f"The answer is on the whiteboard. Check the Whiteboard tab for our findings on: {query_text}",
                        "target": "all",
                        "reasoning": "Query complete",
                        "state": "presenting",
                        "location": "war_room",
                        "position": {"x": 168, "y": 376},
                        "timestamp": datetime.now().isoformat(),
                    })

                    await self.broadcast({
                        "type": "query_completed",
                        "query": query_text,
                        "timestamp": datetime.now().isoformat(),
                    })

                    await self.broadcast({
                        "type": "query_received",
                        "query": "",
                        "timestamp": datetime.now().isoformat(),
                    })
                    await self._broadcast_full_state()

                    logger.info("Query completed: %s", query_text[:60])
                    break  # Stop processing remaining agents in this batch

        # 3. Send periodic full-state snapshot every 5 ticks
        if self._tick_count % 5 == 0:
            await self._broadcast_full_state()

    # ------------------------------------------------------------------
    # Convergence pressure — push agents to deliver
    # ------------------------------------------------------------------

    async def _inject_convergence_pressure(self) -> None:
        """After a few ticks of discussion, push the team to deliver."""
        if not self.office_state.current_query:
            return

        reserved_sandbox_agents = self._active_sandbox_agent_names() | self._assigned_sandbox_agent_names()
        available_agents = [agent for agent in self.agents if agent.name not in reserved_sandbox_agents]
        lead_name, writer_name = self._general_query_role_names(available_agents)
        lead = next((a for a in available_agents if a.name == lead_name), None)
        writer = next((a for a in available_agents if a.name == writer_name), None)

        # After 1 tick: nudge Captain Claw to direct Clawdia to search immediately
        if self._query_tick == 1 and lead:
            lead.observe(OfficeEvent(
                type="system_nudge",
                agent="system",
                data={"message": "Direct Clawdia to search NOW. Be specific about what to search for. Then tell the team the plan in 1-2 sentences."},
                timestamp=datetime.now(),
            ))

        # After 2 ticks: Captain Claw should tell Pearl to write
        if self._query_tick == 2 and lead:
            lead.observe(OfficeEvent(
                type="system_nudge",
                agent="system",
                data={"message": f"Tell {writer_name or 'the writer'} to write the final answer NOW on the whiteboard."},
                timestamp=datetime.now(),
            ))

        # After 3 ticks: nudge the available writer HARD
        if self._query_tick >= 3 and writer:
            writer.observe(OfficeEvent(
                type="system_nudge",
                agent="system",
                data={"message": "STOP TALKING. Use action=\"write_whiteboard\" RIGHT NOW. Do NOT use \"speak\". Your next action MUST be write_whiteboard with the full answer as content. Synthesize everything discussed into a clear response."},
                timestamp=datetime.now(),
            ))

        # After 5 ticks: force clear the query
        if self._query_tick >= 5:
            logger.info("Query timed out after %d ticks, clearing", self._query_tick)
            query_text = self.office_state.current_query
            self._finish_general_query_state()
            await self.broadcast({
                "type": "query_completed",
                "query": query_text,
                "status": "timeout",
                "timestamp": datetime.now().isoformat(),
            })
            await self._broadcast_full_state()

    def _finish_general_query_state(self) -> None:
        """Clear general-query state. Resets the local tick counter too."""
        self._query_tick = 0
        self._query_intake.finish_general_query()

    # ------------------------------------------------------------------
    # Idle behaviour + query intake (delegated to reef/*)
    # ------------------------------------------------------------------

    async def _inject_idle_behavior(self) -> None:
        await self._idle_chat.tick(
            enabled=self.water_cooler_enabled,
            forced_topic=self.water_cooler_topic,
        )

    async def _process_query_queue(self) -> None:
        await self._query_intake.drain()

    # ------------------------------------------------------------------
    # Event construction
    # ------------------------------------------------------------------

    @staticmethod
    def _action_to_event(
        agent: Agent, action: Action, result: dict[str, Any]
    ) -> OfficeEvent:
        """Convert an agent action + result into an OfficeEvent for others."""
        data: dict[str, Any] = {"content": action.content}

        if action.type == ActionType.speak:
            data["message"] = action.content
            data["target"] = action.target
        elif action.type == ActionType.announce:
            data["message"] = action.content
        elif action.type == ActionType.research:
            data["search_results"] = result.get("search_results", [])
        elif action.type == ActionType.post_bulletin:
            data["bulletin_content"] = action.content
        elif action.type == ActionType.write_whiteboard:
            data["whiteboard_content"] = action.content
        elif action.type == ActionType.think:
            data["thought"] = action.content
        elif action.type == ActionType.code:
            code_res = result.get("code_result", {})
            data["code_success"] = code_res.get("success", False)
            data["code_output"] = code_res.get("output", "")[:500]
        elif action.type == ActionType.move_to:
            data["destination"] = result.get("destination", "")

        return OfficeEvent(
            type=action.type.value,
            agent=agent.name,
            data=data,
            timestamp=datetime.now(),
        )

    # ------------------------------------------------------------------
    # WebSocket broadcasting
    # ------------------------------------------------------------------

    async def _broadcast_action(
        self,
        agent: Agent,
        action: Action,
        result: dict[str, Any],
    ) -> None:
        """Send a single action event to all connected frontend clients."""
        payload: dict[str, Any] = {
            "type": "agent_action",
            "agent": agent.name,
            "role": agent.role,
            "action": action.type.value,
            "content": action.content,
            "target": action.target,
            "reasoning": action.reasoning,
            "state": agent.state.value,
            "location": agent.location,
            "position": {"x": agent.position[0], "y": agent.position[1]},
            "claw_id": agent.claw_id,
            "sandbox_name": agent.sandbox_name,
            "connect_command": agent.connect_command,
            "timestamp": datetime.now().isoformat(),
        }

        # Attach notable result details
        if "search_results" in result:
            payload["search_results"] = result["search_results"]
        if "code_result" in result:
            cr = result["code_result"]
            payload["code_result"] = {
                "success": cr.get("success"),
                "output": cr.get("output", "")[:1000],
                "files_created": cr.get("files_created", []),
                "claw_id": cr.get("claw_id"),
                "sandbox_name": cr.get("sandbox_name"),
                "nemoclaw_available": cr.get("nemoclaw_available"),
            }
        if "file_content" in result:
            payload["file_content"] = result["file_content"][:1000]

        await self.broadcast(payload)

    async def _broadcast_full_state(self) -> None:
        """Send a complete state snapshot so late-joining clients sync up."""
        agents_info = [a.to_info() for a in self.agents]
        await self.broadcast(
            {
                "type": "full_state",
                "agents": agents_info,
                "office": self.office_state.to_dict(),
                "sandbox_assignments": self.get_sandbox_assignments(),
                "tick": self._tick_count,
                "timestamp": datetime.now().isoformat(),
            }
        )
