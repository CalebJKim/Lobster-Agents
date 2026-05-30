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


# Query-mode convergence schedule. The orchestrator drives lobsters from
# "discuss the question" toward "write a final answer" by escalating these
# nudges as the query_tick counter ticks up. These used to be magic numbers
# scattered across _push_convergence and _select_active_lobsters; pulling
# them up here makes the cadence tunable in one place.
#
# Tuning history:
# - Old values (3/5/2) were too aggressive — lobsters were getting hard-
#   nudged to write before they'd actually built consensus. The user wanted
#   the conversation to breathe, so we pushed each threshold out.
NARROW_ROSTER_TICK = 4   # was 2 — narrow to the "essential five" after this many ticks
WRITER_DIRECT_TICK = 3   # was 2 — lead is asked to direct the writer
WRITER_NUDGE_TICK = 5    # was 3 — hard nudge "STOP TALKING, write now"
QUERY_TIMEOUT_TICK = 8   # was 5 — give up entirely and clear the query


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

    # ------------------------------------------------------------------
    # Dynamic population — add/remove lobsters at runtime
    # ------------------------------------------------------------------

    async def add_lobster(self, agent: Agent) -> Agent:
        """Append a fresh Agent to the live roster and announce it.

        Callers (routes) construct the Agent + AgentMemory + register the
        claw metadata before handing it here, so this method only touches
        orchestrator-shaped state.
        """
        if any(a.name == agent.name for a in self.agents):
            raise ValueError(f"A lobster named {agent.name!r} already exists.")
        self.agents.append(agent)
        # Register with office state so the frontend sees them on the next
        # /state poll + full_state broadcast.
        from office_agents.claw_config import get_claw_metadata
        self.office_state.register_agent(
            name=agent.name,
            role=agent.role,
            location=agent.location,
            position=agent.position,
            metadata=get_claw_metadata(agent.name),
            color=agent.color,
            appearance=agent.appearance,
            species=agent.species,
            runtime=agent.runtime,
        )
        await self.broadcast({
            "type": "lobster_added",
            "lobster": agent.to_info(),
            "name": agent.name,
            "role": agent.role,
            "species": agent.species,
            "runtime": agent.runtime,
            "timestamp": datetime.now().isoformat(),
        })
        await self._broadcast_full_state()
        return agent

    async def remove_lobster(self, name: str) -> bool:
        """Remove one lobster by name. Returns False if not found.

        Cleans up the sandbox assignment first (so the SandboxManager's
        seat-tracking stays consistent), then drops the agent from the
        roster and the office state.
        """
        agent = next((a for a in self.agents if a.name == name), None)
        if agent is None:
            return False

        # If they're in a sandbox, evict them by reassigning that sandbox
        # to the rest of its current team minus this lobster.
        if agent.sandbox_name:
            sb = agent.sandbox_name
            current = self.sandboxes.assignments.get(sb, [])
            remaining = [n for n in current if n != name]
            try:
                await self.sandboxes.assign_team(sb, remaining)
            except RuntimeError:
                # Can't reassign while a run is active. Refuse removal so
                # we don't strand the in-flight task.
                raise

        self.agents.remove(agent)
        self.office_state.agent_states.pop(name, None)
        await self.broadcast({
            "type": "lobster_removed",
            "name": name,
            "role": agent.role,
            "timestamp": datetime.now().isoformat(),
        })
        await self._broadcast_full_state()
        return True

    def get_sandbox_run_statuses(self) -> dict[str, dict[str, Any]]:
        return self.sandboxes.get_run_statuses()

    def get_sandbox_run_diagnostics(self, sandbox_name: str, run_id: str) -> dict[str, Any] | None:
        return self.sandboxes.get_run_diagnostics(sandbox_name, run_id)

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

    def clear_sandbox_run_status(self, sandbox_name: str) -> None:
        self.sandboxes.clear_sandbox_run_status(sandbox_name)

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

    # Batch order. Captain runs alone first (sets direction); researchers in
    # parallel; analysts/supporters in parallel; writer last (synthesizes).
    # Lobsters not in this dict fall into batch 2 (the silent default).
    _BATCH_ORDER = {
        "Captain Claw": 0,
        "Clawdia": 1,
        "Coraline": 1,
        "Shelldon": 2,
        "Reefus": 2,
        "Snips": 2,
        "Pearl": 3,
    }

    async def _emit_full_state_if_due(self) -> None:
        if self._tick_count % 5 == 0:
            await self._broadcast_full_state()

    def _select_active_lobsters(self) -> list[Agent]:
        """Lobsters eligible to think this tick.

        Excludes any reserved by an active sandbox run or sitting assigned to
        a sandbox. After query_tick >= 2 the team is further narrowed to the
        "essential five" so convergence pressure can land cleanly.
        """
        reserved = self._active_sandbox_agent_names() | self._assigned_sandbox_agent_names()
        active = [a for a in self.agents if a.name not in reserved]
        if self._query_tick >= NARROW_ROSTER_TICK:
            essential = {"Clawdia", "Shelldon", "Coraline", "Pearl", "Captain Claw"}
            active = [a for a in self.agents if a.name in essential and a.name not in reserved]
        return active

    def _group_into_batches(self, agents: list[Agent]) -> list[list[Agent]]:
        """Group lobsters by ``_BATCH_ORDER`` so independent ones run in parallel."""
        batches: dict[int, list[Agent]] = {}
        for agent in agents:
            batches.setdefault(self._BATCH_ORDER.get(agent.name, 2), []).append(agent)
        return [batches[idx] for idx in sorted(batches.keys())]

    async def _run_batch(
        self,
        batch: list[Agent],
        state_snapshot: dict[str, Any],
    ) -> list[tuple[Agent, Action, dict] | None]:
        """Run one batch of lobsters concurrently. Errors are caught and logged
        per-lobster so one bad turn cannot poison the rest of the batch."""

        async def _run_one(agent: Agent) -> tuple[Agent, Action, dict] | None:
            try:
                action = await agent.think(state_snapshot)
                result = await agent.execute(action)
                return (agent, action, result)
            except Exception:
                logger.exception(
                    "Error processing agent %s on tick %d", agent.name, self._tick_count
                )
                return None

        if len(batch) > 1:
            return list(await asyncio.gather(*[_run_one(a) for a in batch]))
        return [await _run_one(batch[0])]

    async def _process_batch_outcomes(
        self,
        outcomes: list[tuple[Agent, Action, dict] | None],
        participant_names: set[str],
    ) -> bool:
        """Apply each outcome: observe → broadcast → record state.

        Returns ``True`` when one of the outcomes was the writer's
        ``write_whiteboard`` and the active query has been finalised — the
        caller stops processing remaining outcomes in the batch in that case.
        """
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
                await self.broadcast(
                    self._agent_action_payload(
                        agent,
                        "speak",
                        result["auto_share"],
                        target="all",
                        reasoning="Sharing research findings",
                    )
                )

            self.office_state.update_from_action(
                agent.name,
                action,
                new_location=agent.location,
                new_position=agent.position,
            )

            if action.type == ActionType.write_whiteboard and self.office_state.current_query:
                await self._finalize_query()
                return True
        return False

    async def _finalize_query(self) -> None:
        """Announce + tear down a completed general query.

        Broadcasts the Captain Claw closing announcement, the
        ``query_completed`` event, an empty ``query_received`` (resets the
        frontend banner), then a fresh full-state snapshot.
        """
        query_text = self.office_state.current_query or ""
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

    def _state_snapshot_for_batch(
        self,
        participant_names: set[str],
        general_lead: str,
        general_writer: str,
    ) -> dict[str, Any]:
        state = self.office_state.to_dict()
        state["query_tick"] = self._query_tick
        state["general_query_lead"] = general_lead
        state["general_query_writer"] = general_writer
        state["agents"] = {
            name: info
            for name, info in state.get("agents", {}).items()
            if name in participant_names
        }
        return state

    async def _tick(self) -> None:
        self._tick_count += 1
        if self.office_state.current_query:
            self._query_tick += 1
        else:
            self._query_tick = 0

        # Prelude: drain queries, run idle behaviour, re-drain (the idle LLM
        # call may have raced with a new query), then apply convergence.
        await self._process_query_queue()
        await self._inject_idle_behavior()
        if not self.query_queue.empty():
            await self._process_query_queue()
        await self._inject_convergence_pressure()

        # Idle path — reef chat handles everything, no per-agent LLM calls.
        if not self.office_state.current_query:
            await self._emit_full_state_if_due()
            return

        active_agents = self._select_active_lobsters()
        if not active_agents:
            await self._emit_full_state_if_due()
            return

        participant_names = {agent.name for agent in active_agents}
        general_lead, general_writer = self._general_query_role_names(active_agents)

        for batch in self._group_into_batches(active_agents):
            # If a query is no longer active but another is queued, bail so the
            # next tick can start it immediately.
            if not self.office_state.current_query and not self.query_queue.empty():
                logger.info("Query waiting — aborting idle tick early")
                break

            if self.office_state.current_query:
                await self.broadcast({
                    "type": "agents_thinking",
                    "agents": [a.name for a in batch],
                    "timestamp": datetime.now().isoformat(),
                })

            state_snapshot = self._state_snapshot_for_batch(
                participant_names, general_lead, general_writer
            )
            outcomes = await self._run_batch(batch, state_snapshot)
            await self._process_batch_outcomes(outcomes, participant_names)

        await self._emit_full_state_if_due()

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

        # Captain Claw should direct the writer.
        if self._query_tick == WRITER_DIRECT_TICK and lead:
            lead.observe(OfficeEvent(
                type="system_nudge",
                agent="system",
                data={"message": f"Tell {writer_name or 'the writer'} to write the final answer NOW on the whiteboard."},
                timestamp=datetime.now(),
            ))

        # Hard nudge the writer.
        if self._query_tick >= WRITER_NUDGE_TICK and writer:
            writer.observe(OfficeEvent(
                type="system_nudge",
                agent="system",
                data={"message": "STOP TALKING. Use action=\"write_whiteboard\" RIGHT NOW. Do NOT use \"speak\". Your next action MUST be write_whiteboard with the full answer as content. Synthesize everything discussed into a clear response."},
                timestamp=datetime.now(),
            ))

        # Force-clear the query.
        if self._query_tick >= QUERY_TIMEOUT_TICK:
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
        """Convert an agent action + result into an OfficeEvent for others.

        ``action.reasoning`` is propagated into the event data for speak,
        announce, and think actions so peer agents can react to *why* a
        teammate said something — not just the surface utterance. Without
        this, conversations were drifting because each lobster only saw
        each other's polished one-liners, never the intent behind them.
        """
        data: dict[str, Any] = {"content": action.content}

        if action.type == ActionType.speak:
            data["message"] = action.content
            data["target"] = action.target
            if action.reasoning:
                data["reasoning"] = action.reasoning
        elif action.type == ActionType.announce:
            data["message"] = action.content
            if action.reasoning:
                data["reasoning"] = action.reasoning
        elif action.type == ActionType.research:
            data["search_results"] = result.get("search_results", [])
        elif action.type == ActionType.post_bulletin:
            data["bulletin_content"] = action.content
        elif action.type == ActionType.write_whiteboard:
            data["whiteboard_content"] = action.content
        elif action.type == ActionType.think:
            data["thought"] = action.content
            if action.reasoning:
                data["reasoning"] = action.reasoning
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

    @staticmethod
    def _agent_action_payload(
        agent: Agent,
        action_type: str,
        content: str,
        *,
        target: str | None = None,
        reasoning: str = "",
    ) -> dict[str, Any]:
        """Build the canonical ``agent_action`` WS payload for one lobster.

        Used by :meth:`_broadcast_action` for real actions and by the
        auto-share branch in :meth:`_tick` when a research-finisher wants to
        synthesize an extra ``speak`` event so teammates can see the summary.
        Keeping the field list in one place prevents drift between the two
        emission sites — the frontend's discriminated union depends on every
        ``agent_action`` having the same shape.
        """
        return {
            "type": "agent_action",
            "agent": agent.name,
            "role": agent.role,
            "action": action_type,
            "content": content,
            "target": target,
            "reasoning": reasoning,
            "state": agent.state.value,
            "location": agent.location,
            "position": {"x": agent.position[0], "y": agent.position[1]},
            "claw_id": agent.claw_id,
            "sandbox_name": agent.sandbox_name,
            "connect_command": agent.connect_command,
            "timestamp": datetime.now().isoformat(),
        }

    async def _broadcast_action(
        self,
        agent: Agent,
        action: Action,
        result: dict[str, Any],
    ) -> None:
        """Send a single action event to all connected frontend clients."""
        payload = self._agent_action_payload(
            agent,
            action.type.value,
            action.content,
            target=action.target,
            reasoning=action.reasoning,
        )

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
