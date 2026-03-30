"""Simulation tick loop — drives all agents and broadcasts events."""

from __future__ import annotations

import asyncio
import logging
import random
import re
from datetime import datetime
from typing import Any, Callable, Coroutine

from office_agents.agents.base import Agent
from office_agents.config import settings
from office_agents.models import Action, ActionType, AgentState, OfficeEvent
from office_agents.office.state import OfficeState

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
        """User replies to a question from an agent (e.g., Sam's ask_user)."""
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
                # Idle: short pause then next water cooler tick.
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
        self._inject_convergence_pressure()

        # 2. Run agent think-act cycles
        #    During active queries, skip agents who won't contribute (Dev, Alex)
        #    to reduce tick time. Run independent agents in PARALLEL for speed.
        #    During IDLE with water cooler: skip agent LLM calls entirely —
        #    the water cooler function already generates chat. This makes idle
        #    ticks ~10s (just the water cooler call) instead of ~30s.
        if not self.office_state.current_query:
            # Idle — water cooler handles everything, no agent LLM calls needed
            if self._tick_count % 5 == 0:
                await self._broadcast_full_state()
            return

        active_agents = self.agents
        if self._query_tick >= 2:
            essential = {"Maya", "Raj", "Sophie", "Jordan", "Sam"}
            active_agents = [a for a in self.agents if a.name in essential]

        # Group agents into parallel batches:
        # Batch 1: Sam (coordinator) — runs first to set direction
        # Batch 2: Maya, Sophie (researchers) — can run in parallel
        # Batch 3: Raj, Alex, Dev (analyzers/supporters) — can run in parallel
        # Batch 4: Jordan (writer) — runs last to synthesize
        _BATCH_ORDER = {"Sam": 0, "Maya": 1, "Sophie": 1, "Raj": 2, "Alex": 2, "Dev": 2, "Jordan": 3}

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
                    if other.name != agent.name:
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
                        if other.name != agent.name:
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
                    self.office_state.current_query = None
                    self.office_state.current_files = []
                    self._query_tick = 0
                    for a in self.agents:
                        a.current_task = None

                    await self.broadcast({
                        "type": "agent_action",
                        "agent": "Sam",
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
                        "type": "query_received",
                        "query": "",
                        "timestamp": datetime.now().isoformat(),
                    })

                    logger.info("Query completed: %s", query_text[:60])
                    break  # Stop processing remaining agents in this batch

        # 3. Send periodic full-state snapshot every 5 ticks
        if self._tick_count % 5 == 0:
            await self._broadcast_full_state()

    # ------------------------------------------------------------------
    # Convergence pressure — push agents to deliver
    # ------------------------------------------------------------------

    def _inject_convergence_pressure(self) -> None:
        """After a few ticks of discussion, push the team to deliver."""
        if not self.office_state.current_query:
            return

        jordan = next((a for a in self.agents if a.name == "Jordan"), None)
        sam = next((a for a in self.agents if a.name == "Sam"), None)

        # After 1 tick: nudge Sam to direct Maya to search immediately
        if self._query_tick == 1 and sam:
            sam.observe(OfficeEvent(
                type="system_nudge",
                agent="system",
                data={"message": "Direct Maya to search NOW. Be specific about what to search for. Then tell the team the plan in 1-2 sentences."},
                timestamp=datetime.now(),
            ))

        # After 2 ticks: Sam should tell Jordan to write
        if self._query_tick == 2 and sam:
            sam.observe(OfficeEvent(
                type="system_nudge",
                agent="system",
                data={"message": "Tell Jordan to write the final answer NOW. Say: 'Jordan, write it up on the whiteboard.'"},
                timestamp=datetime.now(),
            ))

        # After 3 ticks: nudge Jordan HARD
        if self._query_tick >= 3 and jordan:
            jordan.observe(OfficeEvent(
                type="system_nudge",
                agent="system",
                data={"message": "STOP TALKING. Use action=\"write_whiteboard\" RIGHT NOW. Do NOT use \"speak\". Your next action MUST be write_whiteboard with the full answer as content. Synthesize everything discussed into a clear response."},
                timestamp=datetime.now(),
            ))

        # After 5 ticks: force clear the query
        if self._query_tick >= 5:
            logger.info("Query timed out after %d ticks, clearing", self._query_tick)
            self.office_state.current_query = None
            self.office_state.current_files = []
            self._query_tick = 0
            for agent in self.agents:
                agent.current_task = None

    # ------------------------------------------------------------------
    # Idle behaviour — water cooler chat
    # ------------------------------------------------------------------

    _FALLBACK_TOPICS = [
        "Maya's new rescue cat keeps knocking her monitor off the desk",
        "whether the office coffee machine is better than Jordan's $800 home espresso setup",
        "who keeps stealing the good oat milk from the break room fridge",
        "Dev's growing mechanical keyboard collection",
        "Sam's golden retriever Biscuit who crashes every video call",
    ]

    _TOPICS_FILE = "/home/nvidia/documents/demo-files/water-cooler-topics.md"

    @classmethod
    def _load_topics(cls) -> list[str]:
        """Load water cooler topics from the markdown file."""
        try:
            with open(cls._TOPICS_FILE, "r") as f:
                lines = f.readlines()
            topics = [
                l.strip() for l in lines
                if l.strip() and not l.strip().startswith("#")
            ]
            if topics:
                return topics
        except FileNotFoundError:
            logger.info("Water cooler topics file not found, using defaults")
        except Exception:
            logger.exception("Error loading water cooler topics")
        return cls._FALLBACK_TOPICS

    _MOVE_SUGGESTIONS = [
        "You've been at your desk a while. Head to the break room for a coffee?",
        "Go check if anyone's in the break room — might be a good chat happening.",
        "Stretch your legs! Walk to the lobby or the break room.",
        "Swing by a colleague's desk and see what they're up to.",
    ]

    async def _inject_idle_behavior(self) -> None:
        """Water cooler mode: generate casual chat between idle agents."""
        if self.office_state.current_query:
            return
        if not self.water_cooler_enabled:
            return

        idle_agents = [
            a for a in self.agents
            if a.state in (AgentState.idle, AgentState.thinking)
        ]
        if len(idle_agents) < 2:
            return

        # Use forced topic or pick random from file
        if self.water_cooler_topic:
            topic = self.water_cooler_topic
        else:
            topics = self._load_topics()
            topic = random.choice(topics)

        # Every tick: pick a pair and have them chat via LLM
        pair = random.sample(idle_agents, 2)
        agent_a, agent_b = pair

        # Move both to break room if not there
        for agent in pair:
            if agent.location != "break_room":
                from office_agents.office.layout import ROOM_POSITIONS, get_room_position, release_room_seat
                release_room_seat(agent.location, agent.name)
                agent.position = get_room_position("break_room", agent.name)
                agent.location = "break_room"
                self.office_state.update_agent_position(
                    agent.name, "break_room", agent.position
                )

        # Generate water cooler chat using the agent's OWN system prompt
        user_prompt = (
            f"CURRENT STATE:\n"
            f"- Location: break_room\n"
            f"- Working on: nothing specific\n"
            f"- Your state: idle\n\n"
            f"You are ALREADY in the break_room with {agent_b.name}. No query is active.\n"
            f"You're chatting about: {topic}\n\n"
            f"Respond with a JSON action. Say 1-2 casual sentences. Be fun and opinionated!\n"
            f'{{"action": "speak", "target": "{agent_b.name}", '
            f'"content": "your thought here", "reasoning": "coffee chat"}}'
        )

        # Race the LLM call against incoming queries — abort water cooler if query arrives
        llm_task = asyncio.create_task(agent_a.llm.chat(
            system_prompt=agent_a.system_prompt,
            user_prompt=user_prompt,
            temperature=0.9,
            max_tokens=300,
        ))
        query_wait = asyncio.create_task(self._query_event.wait())

        done, pending = await asyncio.wait(
            [llm_task, query_wait],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for t in pending:
            t.cancel()

        if query_wait in done:
            logger.info("Water cooler aborted — query arrived")
            return

        raw = llm_task.result()
        logger.info("Water cooler raw LLM (%d chars): %s", len(raw), raw[:300])

        # Parse the response — extract JSON or use raw text
        import json as _json
        chat_lines: list[tuple[Agent, Agent, str]] = []

        if len(raw.strip()) > 5:  # Skip near-empty responses like just "{"
            try:
                # Find the most complete JSON object
                json_match = re.search(r"\{[^{}]+\}", raw, re.DOTALL)
                if json_match:
                    data = _json.loads(json_match.group())
                    content = data.get("content", "") or data.get("line1", "")
                    if content:
                        chat_lines.append((agent_a, agent_b, content))
            except _json.JSONDecodeError:
                pass

            # Fallback: if no JSON parsed, try "Name: message" format
            if not chat_lines:
                for line in raw.strip().split("\n"):
                    line = line.strip().strip('"')
                    if line.startswith(f"{agent_a.name}:"):
                        msg = line[len(agent_a.name)+1:].strip().strip('"')
                        if msg:
                            chat_lines.append((agent_a, agent_b, msg))
                            break

            # Last resort: use raw text if it looks like speech
            if not chat_lines and len(raw.strip()) > 10 and not raw.strip().startswith("{"):
                chat_lines.append((agent_a, agent_b, raw.strip()[:150]))

        # Broadcast the chat lines
        for speaker, listener, message in chat_lines[:2]:
            speaker.state = AgentState.collaborating

            await self.broadcast({
                "type": "agent_action",
                "agent": speaker.name,
                "role": speaker.role,
                "action": "speak",
                "content": message,
                "target": listener.name,
                "reasoning": "Water cooler chat",
                "state": "collaborating",
                "location": "break_room",
                "position": {"x": speaker.position[0], "y": speaker.position[1]},
                "timestamp": datetime.now().isoformat(),
            })

            event = OfficeEvent(
                type="speak",
                agent=speaker.name,
                data={"message": message, "target": listener.name},
                timestamp=datetime.now(),
            )
            for a in self.agents:
                if a.name != speaker.name:
                    a.observe(event)

        # Reset states
        for agent in pair:
            agent.state = AgentState.idle

    async def _process_query_queue(self) -> None:
        """Drain every pending query from the queue."""
        from office_agents.office.layout import get_room_position, release_room_seat

        while True:
            try:
                query_data = self.query_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

            query_text = query_data["query"]
            files = query_data.get("files", [])

            # Update office state
            self.office_state.current_query = query_text
            self.office_state.current_files = files

            # TELEPORT all agents to war room immediately — skip the "move_to" tick waste
            for agent in self.agents:
                release_room_seat(agent.location, agent.name)
                agent.position = get_room_position("war_room", agent.name)
                agent.location = "war_room"
                agent.state = AgentState.collaborating
                agent.current_task = query_text
                self.office_state.update_agent_position(
                    agent.name, "war_room", agent.position
                )

            # Create event and distribute to all agents
            event = OfficeEvent(
                type="new_query",
                agent="user",
                data={"query": query_text, "files": files},
                timestamp=datetime.now(),
            )
            for agent in self.agents:
                agent.observe(event)

            # Notify frontend
            await self.broadcast(
                {
                    "type": "query_received",
                    "query": query_text,
                    "files": files,
                    "timestamp": datetime.now().isoformat(),
                }
            )
            # Broadcast updated positions so frontend sees them in war room
            await self._broadcast_full_state()
            logger.info("New query distributed (agents teleported to war room): %s", query_text[:80])

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
                "tick": self._tick_count,
                "timestamp": datetime.now().isoformat(),
            }
        )
