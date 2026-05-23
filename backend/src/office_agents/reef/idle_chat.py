"""Idle reef chat — casual dialogue between idle lobsters.

Lives apart from the orchestrator's tick loop. The orchestrator just calls
``await idle_chat.tick()``; this module owns the prompt, the LLM call, the
output cleaning, and the broadcast.

LLM unreachability is surfaced as a `system_warning` event so the frontend
banner can tell the user "the model is down" instead of letting the user
mistake the templated fallback narration for normal behaviour.
"""

from __future__ import annotations

import asyncio
import json as _json
import logging
import random
import re
from datetime import datetime
from typing import Any, Awaitable, Callable

from office_agents.agents.base import Agent
from office_agents.llm.client import LLMError
from office_agents.models import AgentState, OfficeEvent
from office_agents.office.state import OfficeState
from office_agents.sandbox_runtime.manager import short_sandbox_name

logger = logging.getLogger(__name__)


BroadcastFn = Callable[[dict[str, Any]], Awaitable[None]]


FALLBACK_TOPICS = [
    "whether Clawdia's shell polish is attracting too many curious reef fish",
    "who keeps rearranging the shiny pebbles outside the shared NemoClaw workspaces",
    "whether bubble trails should be routed through the kelp gateway",
    "Snips's idea for an automated kelp door on every sandbox workspace",
    "Captain Claw's strict policy on not pinching the anemone furniture",
    "Pearl's theory that the moon tide is judging everyone's shell decor",
    "Reefus mapping the fastest policy-safe route through the kelp forest",
    "Coraline auditing whether tiny fish gossip violates sandbox etiquette",
]

IDLE_SYSTEM_PROMPT = """\
You generate idle dialogue for a cute underwater NemoClaw reef simulation.
The speakers are lobster-shaped OpenClaw profiles. NemoClaw sandboxes are
shared workspaces connected by kelp gateways and coral paths. No workspace
belongs to a lobster unless the user explicitly assigns that profile into it.

Return exactly one JSON object:
{"action":"speak","target":"<listener>","content":"<one cute reef line>","reasoning":"idle reef chat"}

Rules:
- The content must be 1-2 short casual sentences.
- Make every line feel underwater, lobster-specific, and tied to NemoClaw
  sandboxes, OpenClaw agents, gateway policies, coral paths, kelp routes, shell
  decor, bubbles, tides, reef maintenance, tiny fish gossip, or shared workspaces.
- If the requested topic is not reef-themed, convert it into a reef/sandbox
  analogy instead of discussing it literally.
- Do not mention land-office life, human desk gear, household animals, meals,
  meetings, calls, or apartment/workplace complaints.
"""

BANNED_IDLE_TERMS = (
    "coffee", "oat milk", "lunch", "keyboard", "keyboards", "mechanical",
    "switches", "cat", "dog", "pet", "pets", "monitor", "desk", "office",
    "thermostat", "video call", "zoom", "slack", "email", "hard drive",
    "apartment", "work from home", "wfh", "bird", "birds", "finch",
    "finches", "war room",
)

REEF_ANCHORS = (
    "reef", "coral", "kelp", "shell", "tide", "bubble", "sand", "sandbox",
    "nemoclaw", "openclaw", "claw", "lobster", "fish", "anemone", "current",
    "rock hut", "gateway", "pebble",
)

SAFE_IDLE_LINES = [
    "{speaker} taps a pebble map and says the active sandbox workspace needs a kelp-gateway shortcut before the tide gets dramatic.",
    "{speaker} thinks the tiny fish are filing bug reports in bubbles outside the shared NemoClaw workspaces again.",
    "{speaker} votes to decorate the next OpenClaw handoff with pearl markers, coral arrows, and exactly zero pinched anemones.",
    "{speaker} says every sandbox policy should come with a shell-shaped sign and a friendly current warning.",
    "{speaker} claims the reef would run faster if the kelp gateways stopped gossiping with passing fish.",
    "{speaker} is convinced the bridge workspace has the best bubble acoustics for serious lobster planning.",
]

TOPICS_FILE = "/home/nvidia/documents/demo-files/water-cooler-topics.md"


def load_topics() -> list[str]:
    """Read user-defined idle topics, fall back to defaults if the file is missing."""

    try:
        with open(TOPICS_FILE, "r") as f:
            lines = f.readlines()
        topics = [
            l.strip() for l in lines
            if l.strip() and not l.strip().startswith("#")
        ]
        if topics:
            return topics
    except FileNotFoundError:
        logger.info("Reef chat topics file not found, using defaults")
    except Exception:
        logger.exception("Error loading reef chat topics")
    return list(FALLBACK_TOPICS)


def clean_message(
    message: str,
    *,
    speaker: Agent,
    listener: Agent,
    topic: str,
) -> str:
    """Sanitize one LLM idle line; substitute a safe fallback when it drifts."""

    text = " ".join(message.replace("\r", "\n").split())
    text = text.strip().strip('"')
    lower = text.lower()

    if (
        not text
        or any(term in lower for term in BANNED_IDLE_TERMS)
        or lower.startswith("{")
    ):
        return fallback_line(speaker=speaker, listener=listener, topic=topic)

    if not any(anchor in lower for anchor in REEF_ANCHORS):
        text = f"{text.rstrip('.')} - let's reef-translate that into a NemoClaw sandbox plan."

    return text[:260]


def fallback_line(*, speaker: Agent, listener: Agent, topic: str) -> str:
    """Deterministic third-person narration line. Used when the LLM is unreachable."""

    seed = f"{speaker.name}:{listener.name}:{topic}"
    template = SAFE_IDLE_LINES[sum(ord(ch) for ch in seed) % len(SAFE_IDLE_LINES)]
    return template.format(speaker=speaker.name, listener=listener.name)


class IdleChat:
    """Drives one reef-chat exchange per tick when nobody is busy.

    The orchestrator wires us up with everything we need to read state and
    publish events; we don't reach back into the orchestrator.
    """

    def __init__(
        self,
        *,
        agents: list[Agent],
        office_state: OfficeState,
        sandbox_assignments: dict[str, list[str]],
        broadcast: BroadcastFn,
        query_event: asyncio.Event,
    ) -> None:
        self._agents = agents
        self._office_state = office_state
        self._sandbox_assignments = sandbox_assignments
        self._broadcast = broadcast
        self._query_event = query_event
        # Becomes True after we've already broadcast a system_warning for the
        # current LLM outage. Reset to False as soon as we see a non-empty
        # LLM response so the next outage warns again.
        self._llm_outage_announced = False

    async def tick(
        self,
        *,
        enabled: bool,
        forced_topic: str | None,
    ) -> None:
        """Try to produce one reef-chat line. Bails out cheaply when irrelevant."""

        if self._office_state.current_query:
            return
        if not enabled:
            return
        if any(a.state == AgentState.coding for a in self._agents):
            return

        idle_agents = [
            a for a in self._agents
            if a.state in (AgentState.idle, AgentState.thinking)
        ]
        if len(idle_agents) < 2:
            return

        topic = forced_topic or random.choice(load_topics())

        pair, sandbox_name, sandbox_members = self._pick_pair(idle_agents)
        if pair is None:
            return
        agent_a, agent_b = pair

        sandbox_label = short_sandbox_name(sandbox_name) if sandbox_name else "reef commons"
        team_label = ", ".join(a.name for a in sandbox_members) or "mixed reef visitors"

        user_prompt = (
            f"Speaker: {agent_a.name} ({agent_a.role})\n"
            f"Listener: {agent_b.name} ({agent_b.role})\n"
            f"Scene: {sandbox_label} NemoClaw workspace.\n"
            f"Sandbox team in this workspace: {team_label}\n"
            f"User-selected or random idle topic: {topic}\n\n"
            f"Write one cute line from {agent_a.name} to {agent_b.name} in this reef scene. "
            f"Keep the user's topic if one was provided, but reef-translate it through "
            f"NemoClaw sandboxes, OpenClaw lobster profiles, gateway policies, shared workspaces, "
            f"coral, kelp, bubbles, tides, or shell decor."
        )

        raw, llm_error = await self._call_llm_with_abort(agent_a, user_prompt, agent_b.name)
        if raw is None and llm_error is None:
            return  # query arrived mid-chat — bail cleanly

        if llm_error is not None:
            # Emit ONE visible warning on the first failure of this outage and
            # then go quiet. We used to broadcast templated narration as if it
            # were the LLM speaking; that made a dead model look like a working
            # demo. Silence is the honest signal.
            if not self._llm_outage_announced:
                self._llm_outage_announced = True
                await self._broadcast({
                    "type": "system_warning",
                    "source": "llm",
                    "severity": "warning",
                    "message": f"LLM is unreachable ({llm_error}). The reef stays quiet until the model is back.",
                    "timestamp": datetime.now().isoformat(),
                })
            return

        message, llm_produced = self._extract_message(raw or "", agent_a, agent_b, topic)
        if not llm_produced:
            # LLM responded but with nothing usable. Don't broadcast garbage.
            return

        if self._llm_outage_announced:
            # Recovery — emit a clear signal so the user knows it's back.
            self._llm_outage_announced = False
            await self._broadcast({
                "type": "system_warning",
                "source": "llm",
                "severity": "info",
                "message": "LLM is responding again — reef chat is live.",
                "timestamp": datetime.now().isoformat(),
            })

        await self._broadcast_line(agent_a, agent_b, message)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _pick_pair(
        self,
        idle_agents: list[Agent],
    ) -> tuple[tuple[Agent, Agent] | None, str | None, list[Agent]]:
        """Pick a speaker/listener pair from any active chat group.

        A "group" with ≥2 idle members is a candidate: each sandbox team is
        one group; the free-reef pool of unassigned lobsters is another.
        We roll uniformly across all candidate groups so a sandbox having
        chatter doesn't silence the wandering lobsters outside.
        """

        idle_by_name = {a.name: a for a in idle_agents}
        # Each entry: (sandbox_name or None, members)
        groups: list[tuple[str | None, list[Agent]]] = []
        for sandbox_name, assigned in self._sandbox_assignments.items():
            members = [idle_by_name[n] for n in assigned if n in idle_by_name]
            if len(members) >= 2:
                groups.append((sandbox_name, members))

        free_reef = [a for a in idle_agents if not a.sandbox_name]
        if len(free_reef) >= 2:
            groups.append((None, free_reef))

        if not groups:
            return None, None, []

        sandbox_name, members = random.choice(groups)
        pair = random.sample(members, 2)
        # Sandbox label/team data only flows to the prompt when this turn is
        # from a sandbox group; reef-commons turns leave them empty.
        return (
            (pair[0], pair[1]),
            sandbox_name,
            members if sandbox_name else [],
        )

    async def _call_llm_with_abort(
        self,
        speaker: Agent,
        user_prompt: str,
        listener_name: str,
    ) -> tuple[str | None, LLMError | None]:
        """Race the LLM call against the query event.

        Returns:
            (raw, None)              — LLM produced usable text
            (None, None)             — query arrived; bail cleanly
            (None, LLMError)         — LLM call failed; caller should warn the user
        """

        llm_task = asyncio.create_task(speaker.llm.chat(
            system_prompt=IDLE_SYSTEM_PROMPT.replace("<listener>", listener_name),
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
            logger.info("Reef chat aborted - query arrived")
            return None, None
        try:
            raw = llm_task.result()
        except LLMError as exc:
            logger.info("Reef chat LLM unavailable: %s", exc)
            return None, exc
        logger.info("Reef chat raw LLM (%d chars): %s", len(raw), raw[:300])
        return raw, None

    def _extract_message(
        self,
        raw: str,
        speaker: Agent,
        listener: Agent,
        topic: str,
    ) -> tuple[str, bool]:
        """Return (message, llm_produced_usable_content)."""

        if len(raw.strip()) <= 5:
            return fallback_line(speaker=speaker, listener=listener, topic=topic), False

        # 1. Try to parse a JSON object out of the LLM response.
        try:
            match = re.search(r"\{[^{}]+\}", raw, re.DOTALL)
            if match:
                data = _json.loads(match.group())
                content = data.get("content", "") or data.get("line1", "")
                if content:
                    return clean_message(content, speaker=speaker, listener=listener, topic=topic), True
        except _json.JSONDecodeError:
            pass

        # 2. Try a "Name: text" line.
        for line in raw.strip().split("\n"):
            line = line.strip().strip('"')
            prefix = f"{speaker.name}:"
            if line.startswith(prefix):
                msg = line[len(prefix):].strip().strip('"')
                if msg:
                    return clean_message(msg, speaker=speaker, listener=listener, topic=topic), True

        # 3. Free text fallback (don't accept JSON-looking junk).
        stripped = raw.strip()
        if len(stripped) > 10 and not stripped.startswith("{"):
            return clean_message(stripped[:220], speaker=speaker, listener=listener, topic=topic), True

        return fallback_line(speaker=speaker, listener=listener, topic=topic), False

    async def _broadcast_line(self, speaker: Agent, listener: Agent, message: str) -> None:
        await self._broadcast({
            "type": "agent_action",
            "agent": speaker.name,
            "role": speaker.role,
            "action": "speak",
            "content": message,
            "target": listener.name,
            "reasoning": "Idle reef chat",
            "state": speaker.state.value,
            "location": speaker.location,
            "position": {"x": speaker.position[0], "y": speaker.position[1]},
            "sandbox_name": speaker.sandbox_name,
            "timestamp": datetime.now().isoformat(),
        })

        event = OfficeEvent(
            type="speak",
            agent=speaker.name,
            data={"message": message, "target": listener.name, "sandbox_name": speaker.sandbox_name},
            timestamp=datetime.now(),
        )
        for a in self._agents:
            if a.name == speaker.name:
                continue
            if speaker.sandbox_name:
                if a.sandbox_name == speaker.sandbox_name:
                    a.observe(event)
            elif not a.sandbox_name:
                a.observe(event)
