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

You are roleplaying ONE lobster in a casual group chat. Every lobster in
the room can hear every line — most of the time you should be talking TO
THE ROOM, not at any one lobster. Only address someone by name when you
genuinely want THAT lobster's reaction (a direct question, a callback,
calling them out). Otherwise keep target empty.

Return exactly one JSON object. The default shape is:
{"action":"speak","target":"","content":"<one cute reef line>"}

Use a name in target ONLY when you're really asking that lobster something.

Rules:
- Content is 1-2 short casual sentences.
- Sound underwater and reef-themed: NemoClaw sandboxes, OpenClaw agents,
  gateway policies, coral paths, kelp routes, shell decor, bubbles, tides,
  reef maintenance, tiny fish gossip, or shared workspaces.
- Don't restate what someone just said. Move the thread forward.
- Don't mention land-office life, human desk gear, household animals,
  meals, meetings, calls, or apartment/workplace complaints.
- "target" must be empty/"" for a room-wide line (default), OR a name
  from the lobsters-in-room list when you really mean to address them.
  Never invent a name. If unsure, leave it empty.
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

def load_topics() -> list[str]:
    """Read user-defined idle topics, fall back to defaults if the file is missing.

    Path comes from ``settings.water_cooler_topics_path`` so non-Spark hosts can
    override via the ``OFFICE_AGENTS_WATER_COOLER_TOPICS_PATH`` env var.
    """

    from office_agents.config import settings

    try:
        with open(settings.water_cooler_topics_path, "r") as f:
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
        # Consecutive LLM failures since the last successful response. We
        # re-broadcast the outage warning every _OUTAGE_HEAL_AFTER failures
        # so the banner never sticks "stale" — without this the user sees
        # the first warning and then silence forever, even if the model
        # comes back up days later and then dies again.
        self._outage_failures = 0
        self._OUTAGE_HEAL_AFTER = 6
        # Recent idle-chat lines per group (sandbox name or "_commons" for
        # the reef commons). Each tuple is (speaker, target_or_None, message)
        # so the prompt can render "Pearl → Snips: ..." and the model can
        # see who's been addressed.
        self._history: dict[str, list[tuple[str, str | None, str]]] = {}
        # Per-group conversation state — drives turn-based speaker selection.
        # Shape:
        #   {
        #     "topic":           current discussion topic (str)
        #     "turns":           total turns produced for this thread (int)
        #     "speakers_log":    list[str] of recent speaker names, oldest first
        #     "pending_target":  name of lobster who must respond next, or None
        #   }
        self._active: dict[str, dict[str, Any]] = {}
        self._HISTORY_PER_GROUP = 12
        # Average turns a topic persists before the group stochastically
        # rolls a fresh one. Longer than the old pair-based default since
        # we now have richer group dynamics to explore each topic.
        self._THREAD_LENGTH = 6
        # How many recent speakers to exclude when picking the next one.
        # 2 means "the last speaker can't go again, and neither can the one
        # before them" — forces other lobsters into the conversation.
        self._RECENT_SPEAKERS_BLOCK = 2
        # Probability the speaker addresses a specific peer (vs the room).
        # Kept LOW so the default mode is group chatter and direct callouts
        # are a punctuation rather than the constant rhythm. When
        # pending_target is set this is bypassed — they answer the
        # addresser directly.
        self._ADDRESS_PEER_PROB = 0.18

    def reset(self) -> None:
        """Wipe conversation history and active threads. Called from the WS
        reset handler so the UI reset button starts every group with a clean
        slate."""
        self._history.clear()
        self._active.clear()

    async def tick(
        self,
        *,
        enabled: bool,
        forced_topic: str | None,
    ) -> None:
        """Produce one reef-chat line in the active group's rolling thread.

        Group-conversation model: every idle lobster in the group hears every
        line; we pick ONE speaker per tick. Speaker selection priority:
          1. pending_target (if set and still idle) — they got asked a direct
             question last turn and need to respond.
          2. Random pick from group members minus the last N speakers.
        """

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

        group_key, sandbox_name, sandbox_members = self._pick_group(idle_agents)
        if group_key is None:
            return
        members = sandbox_members or [a for a in idle_agents if not a.sandbox_name]
        if len(members) < 2:
            return

        history = self._history.setdefault(group_key, [])
        active = self._active.get(group_key) or {}

        # Topic management: keep the current topic across multiple turns, but
        # stochastically roll a fresh one once the thread has run its course.
        # Forced topic from the UI always wins.
        topic = active.get("topic")
        turns = int(active.get("turns", 0))
        if forced_topic and forced_topic != topic:
            topic = forced_topic
            turns = 0
        elif not topic or (turns >= 1 and random.random() < 1 / self._THREAD_LENGTH):
            topic = forced_topic or random.choice(load_topics())
            turns = 0

        speakers_log: list[str] = list(active.get("speakers_log") or [])
        pending_target: str | None = active.get("pending_target")

        speaker = self._pick_speaker(
            members=members,
            speakers_log=speakers_log,
            pending_target=pending_target,
        )
        if speaker is None:
            return

        # If this speaker was the pending_target, consume it. Otherwise the
        # previous addressee just got skipped (probably went offline) and we
        # should clear the slot anyway so it doesn't haunt later turns.
        responding_to: str | None = None
        if pending_target == speaker.name and speakers_log:
            responding_to = speakers_log[-1]
        pending_target = None

        # Suggest a target for the speaker. We bias toward addressing peers
        # so direct questions land — the model is still free to override via
        # its JSON "target" field, which is what actually drives the next
        # turn's pending_target.
        suggested_target: str | None = None
        peer_candidates = [a for a in members if a.name != speaker.name]
        if peer_candidates and random.random() < self._ADDRESS_PEER_PROB:
            # Prefer addressing someone other than whoever spoke last so we
            # don't just bounce ping-pong between two lobsters.
            non_recent = [a for a in peer_candidates if a.name not in speakers_log[-1:]]
            pool = non_recent or peer_candidates
            suggested_target = random.choice(pool).name

        sandbox_label = short_sandbox_name(sandbox_name) if sandbox_name else "reef commons"
        user_prompt = self._build_prompt(
            sandbox_label=sandbox_label,
            topic=topic,
            members=members,
            history=history,
            speaker=speaker,
            responding_to=responding_to,
            suggested_target=suggested_target,
        )

        raw, llm_error = await self._call_llm_with_abort(speaker, user_prompt, suggested_target)
        if raw is None and llm_error is None:
            return  # query arrived mid-chat — bail cleanly

        if llm_error is not None:
            from office_agents.config import settings as _settings

            self._outage_failures += 1

            should_warn = (
                not self._llm_outage_announced
                or self._outage_failures % self._OUTAGE_HEAL_AFTER == 0
            )
            if should_warn:
                self._llm_outage_announced = True
                await self._broadcast({
                    "type": "system_warning",
                    "source": "llm",
                    "severity": "warning",
                    "message": f"LLM is unreachable ({llm_error}). Reef chat is running on fallback narration.",
                    "timestamp": datetime.now().isoformat(),
                })

            if _settings.reef_fallback_on_outage:
                # For the templated fallback, address the suggested target if
                # we picked one, otherwise pick any peer so the narration
                # reads naturally.
                fb_target_name = suggested_target or random.choice(peer_candidates).name
                fb_target = next(a for a in members if a.name == fb_target_name)
                line = fallback_line(speaker=speaker, listener=fb_target, topic=topic)
                await self._broadcast_line(speaker, fb_target.name, line, source="fallback")
                self._record_turn(
                    group_key=group_key,
                    history=history,
                    speakers_log=speakers_log,
                    speaker=speaker.name,
                    target=fb_target.name,
                    message=line,
                    topic=topic,
                    turns=turns,
                    pending_target=None,
                )
            return

        message, parsed_target, llm_produced = self._extract_message(
            raw or "",
            speaker=speaker,
            members=members,
            suggested_target=suggested_target,
            topic=topic,
        )
        if not llm_produced:
            return

        # Hard cap: when the scheduler picked room mode (no suggested_target
        # AND speaker isn't answering anyone), force the target to None
        # regardless of what the LLM put in the JSON. The model otherwise
        # keeps writing a name into target on basically every turn, which
        # produced the "every line is to X" behavior the user flagged.
        if suggested_target is None and responding_to is None:
            parsed_target = None

        if self._llm_outage_announced:
            self._llm_outage_announced = False
            self._outage_failures = 0
            await self._broadcast({
                "type": "system_warning",
                "source": "llm",
                "severity": "info",
                "message": "LLM is responding again — reef chat is live.",
                "timestamp": datetime.now().isoformat(),
            })
        else:
            self._outage_failures = 0

        await self._broadcast_line(speaker, parsed_target, message)

        # If the speaker addressed a specific peer, that peer becomes the
        # priority responder next tick. Room-wide lines (target=None) leave
        # pending_target unset so the random selector takes over.
        #
        # Anti-pingpong: if the speaker was answering a direct address AND
        # their reply names the same person back, DROP the pending_target.
        # Without this guard, "X → Y, Y → X, X → Y, …" loops two lobsters
        # into a private chat that excludes the rest of the room.
        if parsed_target and parsed_target != speaker.name and parsed_target != responding_to:
            next_pending = parsed_target
        else:
            next_pending = None
        self._record_turn(
            group_key=group_key,
            history=history,
            speakers_log=speakers_log,
            speaker=speaker.name,
            target=parsed_target,
            message=message,
            topic=topic,
            turns=turns,
            pending_target=next_pending,
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _pick_group(
        self,
        idle_agents: list[Agent],
    ) -> tuple[str | None, str | None, list[Agent]]:
        """Pick a chat group: a sandbox team or the free-reef commons.

        Returns ``(group_key, sandbox_name, members)``. ``group_key`` is the
        sandbox name when the group lives inside a sandbox, or ``"_commons"``
        for the reef commons — kept stable so per-group history keys don't
        collide. ``sandbox_name`` is ``None`` for the commons group.
        """

        idle_by_name = {a.name: a for a in idle_agents}
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
        group_key = sandbox_name if sandbox_name else "_commons"
        # Sandbox label/team data only flows to the prompt when this turn is
        # from a sandbox group; reef-commons turns leave members empty so the
        # prompt block stays compact.
        return group_key, sandbox_name, members if sandbox_name else []

    def _pick_speaker(
        self,
        *,
        members: list[Agent],
        speakers_log: list[str],
        pending_target: str | None,
    ) -> Agent | None:
        """Choose who speaks next in the group.

        1. If pending_target is set AND that lobster is in the current idle
           group, they speak (answering a direct address from last turn).
        2. Otherwise pick uniformly at random from members minus the last
           `_RECENT_SPEAKERS_BLOCK` speakers. If that pool is empty (small
           group), fall back to "anyone but the immediate last speaker".
        """

        names = {a.name for a in members}
        if pending_target and pending_target in names:
            return next(a for a in members if a.name == pending_target)

        recent = set(speakers_log[-self._RECENT_SPEAKERS_BLOCK:])
        pool = [a for a in members if a.name not in recent]
        if not pool:
            last = speakers_log[-1] if speakers_log else None
            pool = [a for a in members if a.name != last]
        if not pool:
            return None
        return random.choice(pool)

    def _build_prompt(
        self,
        *,
        sandbox_label: str,
        topic: str,
        members: list[Agent],
        history: list[tuple[str, str | None, str]],
        speaker: Agent,
        responding_to: str | None,
        suggested_target: str | None,
    ) -> str:
        """Build the per-turn user prompt with full group context."""

        roster = ", ".join(a.name for a in members)

        history_block = ""
        last_line_callout = ""
        if history:
            # Last 6 turns is enough to see the discussion's arc without
            # blowing past Spark's prompt-size sweet spot.
            recent = history[-6:]
            rendered = []
            for spk, tgt, msg in recent:
                tag = tgt if tgt else "room"
                rendered.append(f"  {spk} → {tag}: {msg}")
            history_block = "Recent chatter (everyone heard this):\n" + "\n".join(rendered) + "\n\n"
            # Quote the most recent line directly in the prompt so the
            # model can't miss what NOT to repeat. The 35B Qwen has a
            # habit of echoing the previous turn verbatim if we just say
            # "don't repeat anything above" — calling the line out by
            # itself is dramatically more effective.
            last_spk, _, last_msg = recent[-1]
            last_line_callout = (
                f'The most recent line in the chat was {last_spk}: "{last_msg}"\n'
                "Your next line MUST NOT repeat or paraphrase that line. "
                "Take the conversation somewhere new — a different angle, "
                "a question, a counterpoint, or a fresh topic if this one "
                "is exhausted.\n"
            )

        direction = ""
        if responding_to:
            # Answer the addresser, but DON'T necessarily address them back
            # by name — that's what was creating the ping-pong loops. Reply
            # to the room with the answer; if they need a follow-up THEY'll
            # call you out again.
            direction = (
                f"{responding_to} just asked you something — answer it, "
                "but speak to the whole room (leave target empty). Don't "
                "bounce it back at them by name unless you have a real "
                "follow-up question for them.\n"
            )
        elif suggested_target:
            direction = (
                f"Aim this line at {suggested_target} by name — ask them "
                "something, react to them, or call them in.\n"
            )
        else:
            direction = (
                "Speak to the whole room this turn. Leave target empty. "
                "Address the group, not any one lobster.\n"
            )

        return (
            f"Scene: {sandbox_label}. Topic: {topic}.\n"
            f"Lobsters in this chat right now: {roster}.\n"
            f"You are {speaker.name}.\n"
            f"{history_block}"
            f"{last_line_callout}"
            f"{direction}"
            "Write your next line. 1-2 short sentences. Different vocabulary "
            "and a different angle from anything above."
        )

    def _record_turn(
        self,
        *,
        group_key: str,
        history: list[tuple[str, str | None, str]],
        speakers_log: list[str],
        speaker: str,
        target: str | None,
        message: str,
        topic: str,
        turns: int,
        pending_target: str | None,
    ) -> None:
        history.append((speaker, target, message))
        if len(history) > self._HISTORY_PER_GROUP * 2:
            del history[: len(history) - self._HISTORY_PER_GROUP]
        speakers_log.append(speaker)
        # Cap speakers_log so it doesn't grow unbounded over a long session.
        if len(speakers_log) > 16:
            del speakers_log[: len(speakers_log) - 16]
        self._active[group_key] = {
            "topic": topic,
            "turns": turns + 1,
            "speakers_log": speakers_log,
            "pending_target": pending_target,
        }

    async def _call_llm_with_abort(
        self,
        speaker: Agent,
        user_prompt: str,
        listener_name: str | None,
    ) -> tuple[str | None, LLMError | None]:
        """Race the LLM call against the query event.

        Returns:
            (raw, None)              — LLM produced usable text
            (None, None)             — query arrived; bail cleanly
            (None, LLMError)         — LLM call failed; caller should warn the user
        """

        from office_agents.config import settings as _settings  # local import keeps module-load order simple

        # The "<listener>" placeholder in the system prompt is legacy from
        # the pair-based design; in group mode we leave it as-is when no
        # specific listener is set — the model is told to leave target empty
        # in that case.
        system_prompt = IDLE_SYSTEM_PROMPT.replace(
            "<listener>", listener_name or "(any lobster in the room or empty)"
        )
        llm_task = asyncio.create_task(speaker.llm.chat(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.9,
            max_tokens=300,
            timeout=_settings.reef_chat_timeout,
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
        *,
        speaker: Agent,
        members: list[Agent],
        suggested_target: str | None,
        topic: str,
    ) -> tuple[str, str | None, bool]:
        """Return (message, parsed_target, llm_produced_usable_content).

        parsed_target is the lobster the speaker addressed (or None for a
        room-wide line). We accept the LLM's target only if it names a real
        member of the current group; otherwise we drop it and treat the
        line as room-wide.
        """

        valid_names = {a.name for a in members if a.name != speaker.name}

        def _normalize_target(t: Any) -> str | None:
            if not t:
                return None
            t_str = str(t).strip().strip('"').strip("'")
            if not t_str or t_str.lower() in ("room", "all", "everyone", "(room)"):
                return None
            # Case-insensitive match against the roster.
            for name in valid_names:
                if name.lower() == t_str.lower():
                    return name
            return None

        # Pick a "listener" Agent for fallback narration purposes only. Falls
        # back to the suggested target if we have one, else any other member.
        any_listener = next(
            (a for a in members if a.name == suggested_target),
            next((a for a in members if a.name != speaker.name), speaker),
        )

        if len(raw.strip()) <= 5:
            return fallback_line(speaker=speaker, listener=any_listener, topic=topic), None, False

        # 1. JSON object — the canonical path. Pull both content and target.
        try:
            match = re.search(r"\{[^{}]+\}", raw, re.DOTALL)
            if match:
                data = _json.loads(match.group())
                content = data.get("content", "") or data.get("line1", "")
                if content:
                    target = _normalize_target(data.get("target"))
                    listener_for_clean = (
                        next((a for a in members if a.name == target), any_listener)
                    )
                    return (
                        clean_message(content, speaker=speaker, listener=listener_for_clean, topic=topic),
                        target,
                        True,
                    )
        except _json.JSONDecodeError:
            pass

        # 2. "Name: text" line. No target in this branch — treat as room.
        for line in raw.strip().split("\n"):
            line = line.strip().strip('"')
            prefix = f"{speaker.name}:"
            if line.startswith(prefix):
                msg = line[len(prefix):].strip().strip('"')
                if msg:
                    return (
                        clean_message(msg, speaker=speaker, listener=any_listener, topic=topic),
                        None,
                        True,
                    )

        # 3. Free text fallback — also room-wide.
        stripped = raw.strip()
        if len(stripped) > 10 and not stripped.startswith("{"):
            return (
                clean_message(stripped[:220], speaker=speaker, listener=any_listener, topic=topic),
                None,
                True,
            )

        return fallback_line(speaker=speaker, listener=any_listener, topic=topic), None, False

    async def _broadcast_line(
        self,
        speaker: Agent,
        target: str | None,
        message: str,
        *,
        source: str = "llm",
    ) -> None:
        """Broadcast a speak event from speaker to a named target (or room)."""

        await self._broadcast({
            "type": "agent_action",
            "agent": speaker.name,
            "role": speaker.role,
            "action": "speak",
            "content": message,
            # Frontend treats empty string / null as "no target" (room-wide).
            "target": target or None,
            "reasoning": "Idle reef chat" if source == "llm" else "Idle reef chat (fallback narration)",
            "source": source,
            "state": speaker.state.value,
            "location": speaker.location,
            "position": {"x": speaker.position[0], "y": speaker.position[1]},
            "sandbox_name": speaker.sandbox_name,
            "timestamp": datetime.now().isoformat(),
        })

        event = OfficeEvent(
            type="speak",
            agent=speaker.name,
            data={"message": message, "target": target, "sandbox_name": speaker.sandbox_name},
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
