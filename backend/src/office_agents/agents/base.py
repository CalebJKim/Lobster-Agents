"""Core Agent class — perception, thinking, and action execution."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any

from office_agents.agents.memory import AgentMemory
from office_agents.agents.roles import AgentRole
from office_agents.config import settings
from office_agents.llm.client import LLMClient
from office_agents.models import Action, ActionType, AgentState, OfficeEvent, Position
from office_agents.office.layout import ROOM_POSITIONS, get_room_position, release_room_seat, move_toward, room_for_position
from office_agents.tools.file_reader import read_file
from office_agents.tools.opencode import run_opencode
from office_agents.tools.web_search import web_search

logger = logging.getLogger(__name__)

# Maximum events kept in the in-memory queue between ticks
_MAX_EVENT_QUEUE = 50


class Agent:
    """A single office agent with an LLM-driven decision loop."""

    def __init__(
        self,
        role_config: AgentRole,
        llm_client: LLMClient,
        memory: AgentMemory,
    ) -> None:
        self.name = role_config.name
        self.role = role_config.role
        self.default_desk = role_config.default_desk
        self.system_prompt = role_config.system_prompt
        self.personality = role_config.personality
        self.state = AgentState.idle
        self.location = role_config.default_desk
        pos = ROOM_POSITIONS[self.location]
        self.position: tuple[int, int] = pos
        self.target_position: tuple[int, int] | None = None
        self._pending_location: str | None = None  # set when move starts, applied on arrival
        self.current_task: str | None = None
        self.llm = llm_client
        self.memory = memory
        self.event_queue: list[OfficeEvent] = []
        self.findings: list[str] = []
        self._idle_ticks: int = 0  # count consecutive idle/think ticks

    # ------------------------------------------------------------------
    # Perception
    # ------------------------------------------------------------------

    def observe(self, event: OfficeEvent) -> None:
        """Receive an office event (from another agent or the system)."""
        self.event_queue.append(event)
        if len(self.event_queue) > _MAX_EVENT_QUEUE:
            self.event_queue = self.event_queue[-_MAX_EVENT_QUEUE:]

    # ------------------------------------------------------------------
    # Thinking (LLM call)
    # ------------------------------------------------------------------

    async def think(self, office_state: dict[str, Any]) -> Action:
        """Decide the next action by calling the LLM."""
        # Drain events into memory before building prompt
        recent_events_text = self._format_events()
        await self._commit_events_to_memory()

        # Fetch relevant long-term memories
        query_hint = office_state.get("current_query", "") or ""
        long_term = await self.memory.search_long_term(query_hint, limit=5)
        recent_mem = await self.memory.get_recent(limit=15)

        user_prompt = self._build_user_prompt(
            office_state, recent_events_text, recent_mem, long_term
        )

        raw = await self.llm.chat(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=0.6,
            max_tokens=2048,
        )

        action = self._parse_action(raw)
        return action

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    async def execute(self, action: Action) -> dict[str, Any]:
        """Execute the chosen action. Returns result data for broadcasting."""
        result: dict[str, Any] = {"action_type": action.type.value}

        # Track idle ticks for movement encouragement
        if action.type in (ActionType.idle, ActionType.think):
            self._idle_ticks += 1
        else:
            self._idle_ticks = 0

        if action.type == ActionType.research:
            self.state = AgentState.researching
            search_results = await web_search(action.content, max_results=5)
            result["search_results"] = search_results
            # Build a detailed summary of findings for memory AND sharing
            lines = [f"Searched: '{action.content}' — {len(search_results)} results:"]
            for r in search_results[:5]:
                title = r.get("title", "")
                body = r.get("body", "")[:200]
                url = r.get("url", "")
                if title:
                    lines.append(f"  - {title}: {body}")
                    if url:
                        lines.append(f"    Source: {url}")
            summary = "\n".join(lines)
            await self.memory.add_long_term(summary[:500], "finding")
            self.findings.append(summary)
            # Auto-share results as a speak event so team can see them
            result["auto_share"] = summary

        elif action.type == ActionType.read_file:
            self.state = AgentState.researching
            content = await read_file(action.content, settings.allowed_file_paths)
            result["file_content"] = content[:2000]  # cap for broadcast
            await self.memory.add_long_term(
                f"Read file '{action.content}' ({len(content)} chars)", "finding"
            )

        elif action.type == ActionType.code:
            self.state = AgentState.coding
            code_result = await run_opencode(action.content)
            result["code_result"] = code_result
            await self.memory.add_long_term(
                f"Coded: {action.content} — success={code_result.get('success')}",
                "finding",
            )

        elif action.type == ActionType.move_to:
            target_room = action.target or action.content
            if target_room in ROOM_POSITIONS:
                # Release seat in current room before moving
                release_room_seat(self.location, self.name)
                # Get a unique position in the target room (avoids overlap)
                self.position = get_room_position(target_room, self.name)
                self.location = target_room
                self.target_position = None
                self._pending_location = None
                self.state = AgentState.idle
            result["destination"] = target_room

        elif action.type == ActionType.speak:
            self.state = AgentState.collaborating
            result["message"] = action.content
            result["target"] = action.target

        elif action.type == ActionType.announce:
            self.state = AgentState.presenting
            result["message"] = action.content

        elif action.type == ActionType.post_bulletin:
            self.state = AgentState.collaborating
            result["bulletin_content"] = action.content
            await self.memory.add_long_term(
                f"Posted to bulletin: {action.content[:100]}", "finding"
            )

        elif action.type == ActionType.ask_user:
            self.state = AgentState.collaborating
            result["question"] = action.content

        elif action.type == ActionType.write_whiteboard:
            self.state = AgentState.collaborating
            result["whiteboard_content"] = action.content

        elif action.type == ActionType.think:
            self.state = AgentState.thinking
            result["thought"] = action.content
            await self.memory.add_long_term(
                f"Thought: {action.content[:200]}", "opinion"
            )

        elif action.type == ActionType.idle:
            self.state = AgentState.idle

        return result

    # ------------------------------------------------------------------
    # Info for WebSocket broadcast
    # ------------------------------------------------------------------

    def to_info(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "role": self.role,
            "state": self.state.value,
            "location": self.location,
            "position": {"x": self.position[0], "y": self.position[1]},
            "current_task": self.current_task,
        }

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _build_user_prompt(
        self,
        office_state: dict[str, Any],
        recent_events: str,
        recent_memories: list[str],
        long_term: list[str],
    ) -> str:
        lines: list[str] = []

        lines.append("CURRENT STATE:")
        lines.append(f"- Location: {self.location}")
        lines.append(f"- Working on: {self.current_task or 'nothing specific'}")
        lines.append(f"- Your state: {self.state.value}")
        lines.append("")

        # ── Movement encouragement based on context ──
        has_query = bool(office_state.get("current_query"))

        if has_query and self.location != "war_room":
            lines.append(
                "HINT: A query is active and you're not in the war room. "
                "Consider using move_to to head to war_room so you can "
                "collaborate with the team!"
            )
            lines.append("")
        elif has_query and self.location == "war_room":
            lines.append(
                "You are ALREADY in the war_room with the team. "
                "Do NOT use move_to. Focus on the query — speak, research, or think."
            )
            lines.append("")
        elif not has_query:
            # Check if there's a water cooler nudge in recent events
            has_water_cooler = any(
                ev.type == "water_cooler" for ev in self.event_queue[-5:]
            ) if self.event_queue else False

            if has_water_cooler:
                lines.append(
                    "IMPORTANT: No user query is active. This is FREE TIME. "
                    "The rules about 'don't speak unless adding new info' do NOT apply now. "
                    "You're having casual water cooler chat. Use action=speak to say something "
                    "fun, opinionated, or interesting. Be yourself! 1-2 sentences."
                )
            elif self._idle_ticks >= 2:
                at_desk = self.location.startswith("desk_")
                if at_desk:
                    lines.append(
                        "HINT: You've been sitting at your desk for a while with nothing to do. "
                        "Get up and move! Use move_to to visit the break_room."
                    )
                else:
                    lines.append(
                        "HINT: You've been idle for a bit. Consider chatting with "
                        "someone nearby or moving to a different room."
                    )
            lines.append("")

        if office_state.get("current_query"):
            lines.append(f"USER QUERY: {office_state['current_query']}")
            if office_state.get("current_files"):
                lines.append(
                    f"FILES PROVIDED: {', '.join(office_state['current_files'])}"
                )
            query_tick = office_state.get("query_tick", 0)
            if query_tick >= 3 and self.name == "Jordan":
                lines.append(
                    f"🚨 YOU MUST USE write_whiteboard NOW (round {query_tick}). "
                    "Do NOT use speak. Your action MUST be: "
                    '{"action": "write_whiteboard", "content": "<your full answer here>"}. '
                    "Write the complete answer based on everything discussed so far."
                )
            elif query_tick >= 3:
                lines.append(
                    f"⚠️ URGENCY: Round {query_tick}. The answer is overdue. "
                    "Jordan must use write_whiteboard NOW. If you're Sam, tell Jordan directly."
                )
            elif query_tick >= 2:
                lines.append(
                    f"Round {query_tick}. Time to wrap up. Jordan should write the answer."
                )
            lines.append("")

        lines.append("RECENT OFFICE ACTIVITY:")
        if recent_events.strip():
            lines.append(recent_events)
        else:
            lines.append("  (nothing recent)")
        lines.append("")

        if recent_memories:
            lines.append("YOUR RECENT MEMORIES:")
            for mem in recent_memories[-10:]:
                lines.append(f"  - {mem}")
            lines.append("")

        if long_term:
            lines.append("RELEVANT LONG-TERM MEMORIES:")
            for mem in long_term:
                lines.append(f"  - {mem}")
            lines.append("")

        agents = office_state.get("agents", {})
        if agents:
            lines.append("OFFICE STATUS (who is where):")
            for aname, info in agents.items():
                if aname == self.name:
                    continue
                task = info.get("current_task") or "none"
                lines.append(
                    f"  - {aname} ({info.get('role', '?')}): "
                    f"{info.get('state', '?')} at {info.get('location', '?')} "
                    f"| task: {task}"
                )
            lines.append("")

        bulletin = office_state.get("bulletin_posts", [])
        if bulletin:
            lines.append("RECENT BULLETIN POSTS:")
            for post in bulletin[-5:]:
                lines.append(f"  [{post.get('agent', '?')}]: {post.get('content', '')}")
            lines.append("")

        lines.append(
            "Based on all this, what do you do next? "
            "Remember you are in a physical office — move around! "
            "Respond with a single JSON object."
        )
        return "\n".join(lines)

    def _format_events(self) -> str:
        """Format the event queue as a conversation-like log."""
        if not self.event_queue:
            return ""
        lines: list[str] = []
        for ev in self.event_queue[-20:]:
            ts = ev.timestamp.strftime("%H:%M:%S")
            data_str = ""
            if ev.data:
                # Compact representation
                if ev.type == "idle_nudge" or ev.type == "water_cooler":
                    data_str = ev.data.get("suggestion", "Maybe move around?")
                elif ev.type == "system_nudge":
                    data_str = f"⚠️ SYSTEM: {ev.data.get('message', '')}"
                elif "message" in ev.data:
                    data_str = ev.data["message"]
                elif "query" in ev.data:
                    data_str = f"[query] {ev.data['query']}"
                elif "thought" in ev.data:
                    data_str = f"(thinking) {ev.data['thought']}"
                elif "bulletin_content" in ev.data:
                    data_str = f"[bulletin] {ev.data['bulletin_content']}"
                elif "search_results" in ev.data:
                    results = ev.data["search_results"]
                    n = len(results)
                    # Include actual search results so other agents can see them
                    summaries = []
                    for r in results[:5]:
                        title = r.get("title", "")
                        body = r.get("body", "")[:150]
                        url = r.get("url", "")
                        if title:
                            summaries.append(f"  - {title}: {body}" + (f" ({url})" if url else ""))
                    data_str = f"[research] found {n} results:\n" + "\n".join(summaries)
                elif "destination" in ev.data:
                    data_str = f"[moving to] {ev.data['destination']}"
                else:
                    data_str = str(ev.data)[:200]
            lines.append(f"  [{ts}] {ev.agent} ({ev.type}): {data_str}")
        return "\n".join(lines)

    async def _commit_events_to_memory(self) -> None:
        """Move queued events into short-term memory and clear the queue."""
        for ev in self.event_queue:
            summary = f"{ev.agent} {ev.type}"
            if ev.data:
                if "message" in ev.data:
                    summary += f': "{ev.data["message"][:100]}"'
                elif "query" in ev.data:
                    summary += f": {ev.data['query'][:100]}"
            await self.memory.add_short_term(summary, ev.timestamp)
        self.event_queue.clear()

    def _parse_action(self, raw: str) -> Action:
        """Extract a JSON action object from the LLM's raw response.

        Robust against:
        - Preamble text before JSON
        - Truncated JSON (missing closing brace)
        - Unquoted values in reasoning field
        - Markdown code fences around JSON
        """
        # Strip markdown code fences
        cleaned = re.sub(r"```json\s*", "", raw)
        cleaned = re.sub(r"```\s*", "", cleaned)

        # Try multiple JSON extraction strategies
        data = None

        # Strategy 1: find a complete JSON object
        json_match = re.search(r"\{[^{}]*\}", cleaned, re.DOTALL)
        if json_match:
            try:
                data = json.loads(json_match.group())
            except json.JSONDecodeError:
                pass

        # Strategy 2: find JSON starting from first { to last }
        if not data:
            first_brace = cleaned.find("{")
            last_brace = cleaned.rfind("}")
            if first_brace != -1 and last_brace > first_brace:
                candidate = cleaned[first_brace:last_brace + 1]
                try:
                    data = json.loads(candidate)
                except json.JSONDecodeError:
                    # Try fixing common issues: truncated strings, unquoted values
                    try:
                        # Close any unclosed strings and the object
                        fixed = candidate.rstrip().rstrip(",")
                        if fixed.count('"') % 2 == 1:
                            fixed += '"'
                        if not fixed.endswith("}"):
                            fixed += "}"
                        data = json.loads(fixed)
                    except json.JSONDecodeError:
                        pass

        # Strategy 3: extract fields with regex (last resort)
        if not data:
            action_m = re.search(r'"action"\s*:\s*"(\w+)"', cleaned)
            content_m = re.search(r'"content"\s*:\s*"((?:[^"\\]|\\.)*)"', cleaned)
            target_m = re.search(r'"target"\s*:\s*"(\w+)"', cleaned)
            if action_m:
                data = {
                    "action": action_m.group(1),
                    "content": content_m.group(1) if content_m else "",
                    "target": target_m.group(1) if target_m else None,
                }

        if data:
            action_str = data.get("action", "idle")
            try:
                action_type = ActionType(action_str)
            except ValueError:
                logger.warning(
                    "Agent %s returned unknown action '%s', defaulting to idle",
                    self.name, action_str,
                )
                action_type = ActionType.idle

            return Action(
                type=action_type,
                target=data.get("target") or None,
                content=data.get("content") or "",
                reasoning=data.get("reasoning") or "",
            )

        # Fallback: treat as a thought
        logger.warning(
            "Agent %s: no JSON found, treating as thought: %s",
            self.name, raw[:200],
        )
        return Action(
            type=ActionType.think,
            content=raw[:300],
            reasoning="(LLM did not return valid JSON)",
        )
