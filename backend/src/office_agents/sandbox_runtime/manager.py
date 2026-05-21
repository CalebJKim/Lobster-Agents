"""SandboxManager — owns assignments + run lifecycle for NemoClaw sandboxes.

Lives apart from the reef simulation tick loop. The orchestrator holds one of
these and delegates its public sandbox API to it. The manager talks back to
the rest of the system through two callbacks:

* ``broadcast(payload)`` — fires individual WebSocket events
* ``broadcast_full_state()`` — requests a fresh snapshot broadcast

It owns three pieces of state:

* ``assignments``         sandbox_name → ordered list of lobster names
* ``_run_tasks``          run_id → asyncio.Task for the running OpenClaw job
* ``_run_meta``           run_id → status dict surfaced to the UI

Everything else (LLM, reef chat, query workflow) is somebody else's problem.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Awaitable, Callable
from uuid import uuid4

from office_agents.agents.base import Agent
from office_agents.claw_config import get_home_room_for_sandbox
from office_agents.config import settings
from office_agents.models import AgentState
from office_agents.office.layout import get_room_position, release_room_seat
from office_agents.office.state import OfficeState
from office_agents.sandbox_runtime.openclaw import ensure_openclaw_agent, run_openclaw
from office_agents.sandbox_runtime.nemoclaw import get_policy_presets

logger = logging.getLogger(__name__)


def short_sandbox_name(sandbox_name: str | None) -> str:
    """Human-friendly label for a NemoClaw sandbox name."""

    if not sandbox_name:
        return "reef commons"
    return sandbox_name.removeprefix("nemoclaw-").replace("-", " ")


BroadcastFn = Callable[[dict[str, Any]], Awaitable[None]]
FullStateFn = Callable[[], Awaitable[None]]


class SandboxManager:
    """Owns sandbox team assignments and active task runs."""

    def __init__(
        self,
        *,
        agents: list[Agent],
        office_state: OfficeState,
        broadcast: BroadcastFn,
        broadcast_full_state: FullStateFn,
    ) -> None:
        self._agents = agents
        self._office_state = office_state
        self._broadcast = broadcast
        self._broadcast_full_state = broadcast_full_state

        self.assignments: dict[str, list[str]] = {}
        self._run_tasks: dict[str, asyncio.Task[None]] = {}
        self._run_meta: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------------
    # Read helpers (used by the tick loop and the routes)
    # ------------------------------------------------------------------

    def get_assignments(self) -> dict[str, list[str]]:
        """Snapshot of sandbox → assigned agent names."""

        return {name: list(agent_names) for name, agent_names in self.assignments.items()}

    def get_run_statuses(self) -> dict[str, dict[str, Any]]:
        """Latest known task run per sandbox, with `running` derived live."""

        by_sandbox: dict[str, dict[str, Any]] = {}
        for run_id, meta in self._run_meta.items():
            sandbox_name = meta.get("sandbox_name")
            if not isinstance(sandbox_name, str):
                continue

            task = self._run_tasks.get(run_id)
            item = dict(meta)
            item["run_id"] = run_id
            item["running"] = bool(task and not task.done())

            existing = by_sandbox.get(sandbox_name)
            if not existing or str(item.get("started_at", "")) >= str(existing.get("started_at", "")):
                by_sandbox[sandbox_name] = item
        return by_sandbox

    def active_agent_names(self) -> set[str]:
        """Agents currently owned by a running sandbox task."""

        names: set[str] = set()
        for run_id, task in self._run_tasks.items():
            if task.done():
                continue
            agents = self._run_meta.get(run_id, {}).get("agents")
            if isinstance(agents, list):
                names.update(name for name in agents if isinstance(name, str))
        return names

    def active_sandbox_names(self) -> set[str]:
        """Sandboxes with a running task."""

        names: set[str] = set()
        for run_id, task in self._run_tasks.items():
            if task.done():
                continue
            sandbox_name = self._run_meta.get(run_id, {}).get("sandbox_name")
            if isinstance(sandbox_name, str):
                names.add(sandbox_name)
        return names

    def assigned_agent_names(self) -> set[str]:
        """Agents reserved by any team assignment (running or not)."""

        names: set[str] = set()
        for assigned in self.assignments.values():
            names.update(name for name in assigned if isinstance(name, str))
        return names

    # ------------------------------------------------------------------
    # Lifecycle: reset / cancel
    # ------------------------------------------------------------------

    def clear_run_statuses(self) -> None:
        """Drop visible run history after a full simulation reset."""

        self._run_tasks.clear()
        self._run_meta.clear()

    async def cancel_all_runs(self, reason: str = "reset") -> None:
        """Cancel every active run. Waits for tasks to actually finish."""

        pending: list[asyncio.Task[None]] = []
        for run_id, task in list(self._run_tasks.items()):
            if task.done():
                continue
            meta = self._run_meta.get(run_id, {})
            meta["status"] = "cancelling"
            meta["cancel_reason"] = reason
            meta["cancel_requested_at"] = datetime.now().isoformat()
            sandbox_name = meta.get("sandbox_name")
            task.cancel()
            pending.append(task)
            await self._broadcast({
                "type": "sandbox_task_cancelling",
                "run_id": run_id,
                "sandbox_name": sandbox_name,
                "timestamp": datetime.now().isoformat(),
            })
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    # ------------------------------------------------------------------
    # Assignment API
    # ------------------------------------------------------------------

    async def assign_team(
        self,
        sandbox_name: str,
        agent_names: list[str],
    ) -> dict[str, list[str]]:
        """Assign visible lobster profiles to one NemoClaw sandbox."""

        known = {agent.name: agent for agent in self._agents}
        requested = list(dict.fromkeys(agent_names))
        unknown = [n for n in requested if n not in known]
        if unknown:
            raise ValueError(f"Unknown lobster profile(s): {', '.join(unknown)}")

        unique = [n for n in requested if n in known]
        if not get_home_room_for_sandbox(sandbox_name):
            logger.warning(
                "Rejected sandbox assignment without physical room: sandbox=%s agents=%s",
                sandbox_name, unique,
            )
            raise ValueError(f"{sandbox_name} does not map to a physical sandbox hut.")

        current = self.assignments.get(sandbox_name, [])
        if current == unique:
            return self.get_assignments()

        active_sandboxes = self.active_sandbox_names()
        active_agents = self.active_agent_names()
        if sandbox_name in active_sandboxes or any(n in active_agents for n in unique):
            logger.warning(
                "Rejected sandbox assignment during active run: sandbox=%s agents=%s",
                sandbox_name, unique,
            )
            raise RuntimeError("Cannot change sandbox teams while an affected sandbox run is active.")

        previous = set(self.assignments.get(sandbox_name, []))

        # Remove these names from every other sandbox first; they can only live in one.
        for assigned in self.assignments.values():
            assigned[:] = [n for n in assigned if n not in unique]

        self.assignments[sandbox_name] = []
        for name in unique:
            self.assignments[sandbox_name].append(name)
            self._place_agent(known[name], sandbox_name)

        # Release anyone removed from the target team who isn't in any other team.
        for name in previous.difference(unique):
            if any(name in assigned for assigned in self.assignments.values()):
                continue
            agent = known.get(name)
            if agent:
                self._release_agent(agent)

        logger.info(
            "Sandbox team updated: sandbox=%s agents=%s assignments=%s",
            sandbox_name,
            ",".join(unique) or "(none)",
            self.get_assignments(),
        )
        await self._broadcast({
            "type": "sandbox_team_updated",
            "sandbox_name": sandbox_name,
            "assignments": self.get_assignments(),
            "timestamp": datetime.now().isoformat(),
        })
        await self._broadcast_full_state()
        return self.get_assignments()

    def _place_agent(self, agent: Agent, sandbox_name: str) -> None:
        target_room = get_home_room_for_sandbox(sandbox_name)
        agent.sandbox_name = sandbox_name
        agent.connect_command = f"nemoclaw {sandbox_name} connect"
        if not target_room:
            return
        release_room_seat(agent.location, agent.name)
        agent.position = get_room_position(target_room, agent.name)
        agent.location = target_room
        agent.target_position = None
        agent.current_task = None
        agent.state = AgentState.idle
        self._office_state.update_agent_position(agent.name, target_room, agent.position)
        state = self._office_state.agent_states.setdefault(agent.name, {})
        state["state"] = AgentState.idle.value
        state["current_task"] = None
        state["sandbox_name"] = sandbox_name
        state["connect_command"] = agent.connect_command

    def _release_agent(self, agent: Agent) -> None:
        next_room = "war_room" if self._office_state.current_query else "break_room"
        release_room_seat(agent.location, agent.name)
        agent.sandbox_name = None
        agent.connect_command = None
        agent.position = get_room_position(next_room, agent.name)
        agent.location = next_room
        agent.target_position = None
        agent.current_task = self._office_state.current_query
        agent.state = AgentState.collaborating if self._office_state.current_query else AgentState.idle
        self._office_state.update_agent_position(agent.name, next_room, agent.position)
        state = self._office_state.agent_states.setdefault(agent.name, {})
        state["state"] = agent.state.value
        state["current_task"] = agent.current_task
        state["sandbox_name"] = None
        state["connect_command"] = None

    # ------------------------------------------------------------------
    # Run API
    # ------------------------------------------------------------------

    async def run_team_task(
        self,
        sandbox_name: str,
        task: str,
        agent_names: list[str] | None = None,
    ) -> str:
        """Start an OpenClaw task for the assigned team inside this sandbox.

        Returns the run_id. If a run is already active in the sandbox, that
        existing run_id is returned (re-broadcasting `sandbox_task_started`
        so a late-joining client can rehydrate its UI).
        """

        assigned = self.assignments.get(sandbox_name, [])
        if agent_names is None:
            selected_names = assigned
        else:
            assigned_set = set(assigned)
            selected_names = [n for n in agent_names if n in assigned_set]
        known = {agent.name: agent for agent in self._agents}
        selected = [known[n] for n in selected_names if n in known]
        if assigned and not selected:
            raise ValueError("Requested agents are not assigned to this sandbox.")

        # If a run is already active here, surface its started event and return.
        for existing_run_id, existing_task in self._run_tasks.items():
            meta = self._run_meta.get(existing_run_id, {})
            if meta.get("sandbox_name") == sandbox_name and not existing_task.done():
                await self._broadcast({
                    "type": "sandbox_task_started",
                    "run_id": existing_run_id,
                    "sandbox_name": sandbox_name,
                    "agents": meta.get("agents", []),
                    "task": meta.get("task", task),
                    "mode": meta.get("mode", "single"),
                    "policies": meta.get("policies", []),
                    "timestamp": datetime.now().isoformat(),
                })
                return existing_run_id

        run_id = f"{sandbox_name}-{uuid4().hex[:8]}"

        if not selected:
            await self._broadcast({
                "type": "agent_action",
                "agent": "Captain Claw",
                "role": "lead",
                "action": "announce",
                "content": f"No lobsters are assigned to {sandbox_name}. Drag a claw into the sandbox first.",
                "target": "all",
                "reasoning": "Sandbox task could not start",
                "state": "idle",
                "location": "war_room",
                "position": {"x": 168, "y": 432},
                "timestamp": datetime.now().isoformat(),
            })
            raise ValueError(f"No lobsters are assigned to {sandbox_name}.")

        # Snapshot the sandbox's currently-enabled policies BEFORE we kick off
        # the run so the UI can display "running with policies X, Y" instead of
        # pretending policies aren't a thing. (The sandbox enforces them out of
        # band; we just surface what's active.)
        active_policies = await self._snapshot_active_policies(sandbox_name)

        self._run_meta[run_id] = {
            "run_id": run_id,
            "sandbox_name": sandbox_name,
            "agents": [agent.name for agent in selected],
            "task": task,
            "status": "running",
            "started_at": datetime.now().isoformat(),
            "outputs": {},
            "errors": {},
            # 1 lobster → "single", 2+ → "coordinated" (each sees prior outputs).
            "mode": "single" if len(selected) == 1 else "coordinated",
            "policies": active_policies,
        }
        self._run_tasks[run_id] = asyncio.create_task(
            self._execute_team_task(
                run_id=run_id,
                sandbox_name=sandbox_name,
                task=task,
                agents=selected,
            )
        )
        return run_id

    async def cancel_team_task(
        self,
        sandbox_name: str,
        run_id: str,
    ) -> dict[str, Any]:
        """Cancel a specific run. Idempotent if it's already done."""

        run_task = self._run_tasks.get(run_id)
        meta = self._run_meta.get(run_id, {})
        if meta and meta.get("sandbox_name") != sandbox_name:
            return {
                "status": "wrong_sandbox",
                "cancelled": False,
                "run_id": run_id,
                "sandbox_name": sandbox_name,
            }
        if not run_task or run_task.done():
            return {
                "status": "not_running",
                "cancelled": False,
                "run_id": run_id,
                "sandbox_name": sandbox_name,
            }

        meta["status"] = "cancelling"
        meta["cancel_requested_at"] = datetime.now().isoformat()
        run_task.cancel()
        await self._broadcast({
            "type": "sandbox_task_cancelling",
            "run_id": run_id,
            "sandbox_name": sandbox_name,
            "timestamp": datetime.now().isoformat(),
        })
        return {
            "status": "cancel_requested",
            "cancelled": True,
            "run_id": run_id,
            "sandbox_name": sandbox_name,
        }

    # ------------------------------------------------------------------
    # Internal task body
    # ------------------------------------------------------------------

    async def _snapshot_active_policies(self, sandbox_name: str) -> list[str]:
        """Return the names of currently-enabled policy presets for this sandbox.

        Best-effort: any failure surfaces as an empty list rather than blocking
        the run. The result is informational only — NemoClaw enforces policies
        out of band; we just display them.
        """
        try:
            info = await get_policy_presets(sandbox_name)
        except Exception:
            logger.exception("Could not snapshot policies for %s", sandbox_name)
            return []
        return [
            p["name"] for p in info.get("policies", [])
            if isinstance(p, dict) and p.get("enabled") and isinstance(p.get("name"), str)
        ]

    async def _broadcast_progress(
        self,
        *,
        run_id: str,
        sandbox_name: str,
        message: str,
        agent: str | None = None,
        phase: str = "running",
    ) -> None:
        meta = self._run_meta.get(run_id)
        if meta:
            meta["phase"] = phase
            meta["last_message"] = message
            meta["last_update_at"] = datetime.now().isoformat()
            if agent:
                meta["current_agent"] = agent

        await self._broadcast({
            "type": "sandbox_task_progress",
            "run_id": run_id,
            "sandbox_name": sandbox_name,
            "agent": agent,
            "phase": phase,
            "message": message,
            "timestamp": datetime.now().isoformat(),
        })

    async def _execute_team_task(
        self,
        *,
        run_id: str,
        sandbox_name: str,
        task: str,
        agents: list[Agent],
    ) -> None:
        try:
            logger.info(
                "Sandbox team task started: run_id=%s sandbox=%s agents=%s task=%s",
                run_id,
                sandbox_name,
                ",".join(agent.name for agent in agents),
                task[:120],
            )
            meta_at_start = self._run_meta.get(run_id, {})
            await self._broadcast({
                "type": "sandbox_task_started",
                "run_id": run_id,
                "sandbox_name": sandbox_name,
                "agents": [agent.name for agent in agents],
                "task": task,
                "mode": meta_at_start.get("mode", "single"),
                "policies": meta_at_start.get("policies", []),
                "timestamp": datetime.now().isoformat(),
            })
            mode_label = "in a coordinated relay" if len(agents) > 1 else "solo in this sandbox"
            await self._broadcast_progress(
                run_id=run_id,
                sandbox_name=sandbox_name,
                message=(
                    f"Moved {len(agents)} claw{'s' if len(agents) != 1 else ''} into "
                    f"{short_sandbox_name(sandbox_name)} — running {mode_label}."
                ),
                phase="positioning",
            )

            for agent in agents:
                self._move_agent_into_sandbox(agent, sandbox_name, task)
                await self._broadcast({
                    "type": "agent_action",
                    "agent": agent.name,
                    "role": agent.role,
                    "action": "code",
                    "content": task,
                    "target": sandbox_name,
                    "reasoning": f"Running OpenClaw profile {agent.claw_id} inside NemoClaw sandbox {sandbox_name}",
                    "state": "coding",
                    "location": agent.location,
                    "position": {"x": agent.position[0], "y": agent.position[1]},
                    "claw_id": agent.claw_id,
                    "sandbox_name": sandbox_name,
                    "connect_command": agent.connect_command,
                    "timestamp": datetime.now().isoformat(),
                })

            # Coordinated relay: each agent sees the outputs of teammates who
            # came before so they can build on the work instead of duplicating it.
            results: list[tuple[Agent, dict[str, Any]]] = []
            prior_turns: list[dict[str, str]] = []
            for agent in agents:
                try:
                    agent_obj, result = await self._run_one_agent(
                        run_id,
                        sandbox_name,
                        task,
                        agent,
                        prior_turns=list(prior_turns) if prior_turns else None,
                    )
                    results.append((agent_obj, result))
                    if result.get("success"):
                        output_text = str(result.get("output") or "").strip()
                        if output_text:
                            prior_turns.append({
                                "name": agent.name,
                                "role": agent.role,
                                "output": output_text,
                            })
                except Exception as exc:
                    logger.exception("Sandbox team task failed for %s", agent.name)
                    results.append((agent, {"success": False, "output": f"{type(exc).__name__}: {exc}"}))

            for agent, result in results:
                await self._record_agent_result(run_id, sandbox_name, agent, result)

            self._reset_agents(agents)
            meta = self._run_meta.get(run_id)
            if meta:
                meta["status"] = "finished"
                meta["finished_at"] = datetime.now().isoformat()
            await self._broadcast({
                "type": "sandbox_task_finished",
                "run_id": run_id,
                "sandbox_name": sandbox_name,
                "agents": [agent.name for agent in agents],
                "timestamp": datetime.now().isoformat(),
            })
            await self._broadcast_full_state()
        except asyncio.CancelledError:
            logger.info("Sandbox team task cancelled: run_id=%s sandbox=%s", run_id, sandbox_name)
            meta = self._run_meta.get(run_id)
            if meta:
                meta["status"] = "cancelled"
                meta["cancelled_at"] = datetime.now().isoformat()
            self._reset_agents(agents)
            await self._broadcast({
                "type": "sandbox_task_cancelled",
                "run_id": run_id,
                "sandbox_name": sandbox_name,
                "agents": [agent.name for agent in agents],
                "timestamp": datetime.now().isoformat(),
            })
            await self._broadcast({
                "type": "agent_action",
                "agent": "Captain Claw",
                "role": "lead",
                "action": "announce",
                "content": f"Stopped the active run in {sandbox_name}.",
                "target": "all",
                "reasoning": "Sandbox team task cancelled",
                "state": "idle",
                "location": "war_room",
                "position": {"x": 168, "y": 432},
                "sandbox_name": sandbox_name,
                "timestamp": datetime.now().isoformat(),
            })
            await self._broadcast_full_state()
        finally:
            self._run_tasks.pop(run_id, None)

    def _move_agent_into_sandbox(self, agent: Agent, sandbox_name: str, task: str) -> None:
        target_room = get_home_room_for_sandbox(sandbox_name)
        if target_room:
            release_room_seat(agent.location, agent.name)
            agent.position = get_room_position(target_room, agent.name)
            agent.location = target_room
            agent.target_position = None
            self._office_state.update_agent_position(agent.name, target_room, agent.position)

        agent.sandbox_name = sandbox_name
        agent.connect_command = f"nemoclaw {sandbox_name} connect"
        agent.current_task = task
        agent.state = AgentState.coding
        state = self._office_state.agent_states.setdefault(agent.name, {})
        state["state"] = AgentState.coding.value
        state["current_task"] = task
        state["sandbox_name"] = sandbox_name
        state["connect_command"] = agent.connect_command

    async def _run_one_agent(
        self,
        run_id: str,
        sandbox_name: str,
        task: str,
        agent: Agent,
        prior_turns: list[dict[str, str]] | None = None,
    ) -> tuple[Agent, dict[str, Any]]:
        await self._broadcast_progress(
            run_id=run_id,
            sandbox_name=sandbox_name,
            agent=agent.name,
            phase="profile",
            message=f"Preparing {agent.name}'s OpenClaw profile in this sandbox.",
        )
        ensure_result = await ensure_openclaw_agent(
            sandbox_name=sandbox_name,
            claw_id=agent.claw_id,
            display_name=agent.name,
            model=f"inference/{settings.llm_model}",
        )
        if not ensure_result.get("success"):
            logger.warning(
                "OpenClaw agent profile ensure failed: sandbox=%s agent=%s output=%s",
                sandbox_name,
                agent.name,
                str(ensure_result.get("output", ""))[:300],
            )
        relay_note = (
            f" — building on {len(prior_turns)} teammate turn{'s' if len(prior_turns) != 1 else ''}"
            if prior_turns else ""
        )
        await self._broadcast_progress(
            run_id=run_id,
            sandbox_name=sandbox_name,
            agent=agent.name,
            phase="openclaw",
            message=f"Running {agent.name}'s OpenClaw turn in {short_sandbox_name(sandbox_name)}{relay_note}.",
        )
        result = await run_openclaw(
            task,
            claw_id=agent.claw_id,
            sandbox_name=sandbox_name,
            timeout_seconds=90,
            require_sandbox=True,
            display_name=agent.name,
            role_label=agent.role,
            personality=getattr(agent, "personality", None),
            tools=list(agent.tools),
            prior_turns=prior_turns or None,
        )
        return agent, result

    async def _record_agent_result(
        self,
        run_id: str,
        sandbox_name: str,
        agent: Agent,
        result: dict[str, Any],
    ) -> None:
        agent.state = AgentState.idle
        agent.current_task = None

        output = str(result.get("output") or "").strip()
        if not output:
            output = "No visible response returned."
        if len(output) > 700:
            output = output[:697].rstrip() + "..."

        status = "finished" if result.get("success") else "hit a sandbox error"
        meta = self._run_meta.get(run_id)
        if meta is not None:
            outputs = meta.setdefault("outputs", {})
            errors = meta.setdefault("errors", {})
            if result.get("success"):
                outputs[agent.name] = output
                errors.pop(agent.name, None)
            else:
                errors[agent.name] = output
        logger.info(
            "Sandbox team task result: run_id=%s sandbox=%s agent=%s success=%s output=%s",
            run_id,
            sandbox_name,
            agent.name,
            result.get("success"),
            output[:300],
        )
        await self._broadcast_progress(
            run_id=run_id,
            sandbox_name=sandbox_name,
            agent=agent.name,
            phase="result",
            message=f"{agent.name} {status}.",
        )
        await self._broadcast({
            "type": "agent_action",
            "agent": agent.name,
            "role": agent.role,
            "action": "announce",
            "content": f"{agent.name} {status} in {sandbox_name}: {output}",
            "target": "all",
            "reasoning": "Sandbox team task result",
            "state": agent.state.value,
            "location": agent.location,
            "position": {"x": agent.position[0], "y": agent.position[1]},
            "claw_id": agent.claw_id,
            "sandbox_name": sandbox_name,
            "connect_command": agent.connect_command,
            "timestamp": datetime.now().isoformat(),
        })

    def _reset_agents(self, agents: list[Agent]) -> None:
        """Return task-running agents to idle after stop/finish cleanup."""

        for agent in agents:
            agent.state = AgentState.idle
            agent.current_task = None
            state = self._office_state.agent_states.setdefault(agent.name, {})
            state["state"] = AgentState.idle.value
            state["current_task"] = None
            state["location"] = agent.location
            state["position"] = {"x": agent.position[0], "y": agent.position[1]}
