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
import traceback
from datetime import datetime
from typing import Any, Awaitable, Callable
from uuid import uuid4

from office_agents.agents.base import Agent
from office_agents.claw_config import SANDBOX_WORKSPACES, SandboxWorkspace
from office_agents.config import settings
from office_agents.models import AgentState
from office_agents.office.layout import get_room_position, release_room_seat
from office_agents.office.state import OfficeState
from office_agents.sandbox_runtime.openclaw import (
    DEFAULT_RUNS_WORKDIR,
    ensure_openclaw_agent,
    run_openclaw,
)
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
        self._sandbox_home_rooms: dict[str, str] = {
            workspace.name: workspace.home_room for workspace in SANDBOX_WORKSPACES
        }

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
            # Console lines can grow to hundreds of entries; keep them behind
            # the diagnostics endpoint instead of bloating every /sandboxes poll.
            item.pop("console", None)

            existing = by_sandbox.get(sandbox_name)
            if not existing or str(item.get("started_at", "")) >= str(existing.get("started_at", "")):
                by_sandbox[sandbox_name] = item
        return by_sandbox

    def sync_sandbox_workspaces(self, workspaces: list[SandboxWorkspace]) -> None:
        """Refresh the dynamic sandbox-name to reef-room mapping.

        The FastAPI route layer owns persistence; the manager only needs the
        current mapping so assignment and run movement can treat user-created
        sandboxes exactly like the starter four.
        """
        self._sandbox_home_rooms = {
            workspace.name: workspace.home_room for workspace in workspaces
        }

    def _home_room_for_sandbox(self, sandbox_name: str) -> str | None:
        return self._sandbox_home_rooms.get(sandbox_name)

    def get_run_diagnostics(self, sandbox_name: str, run_id: str) -> dict[str, Any] | None:
        """Return the detailed, per-run diagnostic record retained in memory."""

        meta = self._run_meta.get(run_id)
        if not meta or meta.get("sandbox_name") != sandbox_name:
            return None

        task = self._run_tasks.get(run_id)
        item = dict(meta)
        item["run_id"] = run_id
        item["running"] = bool(task and not task.done())
        return {
            "run_id": run_id,
            "sandbox_name": sandbox_name,
            "run_status": item,
            "agent_runs": item.get("agent_runs", {}),
            "skill_status": item.get("skill_status", {}),
            "policy_snapshot": item.get("policy_snapshot", item.get("policies", [])),
            "failure_kind": item.get("failure_kind"),
            "failure_detail": item.get("failure_detail"),
            "timed_out": item.get("timed_out", False),
            "partial_output": item.get("partial_output", {}),
            "tool_errors": item.get("tool_errors", []),
            "console": item.get("console", []),
            "violations": item.get("violations", []),
        }

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

    def clear_sandbox_run_status(self, sandbox_name: str) -> None:
        """Drop finished/cancelled visible run history for one sandbox."""

        for run_id, meta in list(self._run_meta.items()):
            if meta.get("sandbox_name") != sandbox_name:
                continue
            task = self._run_tasks.get(run_id)
            if task and not task.done():
                continue
            self._run_meta.pop(run_id, None)
            self._run_tasks.pop(run_id, None)

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
        if not self._home_room_for_sandbox(sandbox_name):
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
        target_room = self._home_room_for_sandbox(sandbox_name)
        agent.sandbox_name = sandbox_name
        agent.sandbox_home_room = target_room
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
        state["sandbox_home_room"] = target_room
        state["connect_command"] = agent.connect_command

    def _release_agent(self, agent: Agent) -> None:
        next_room = "war_room" if self._office_state.current_query else "break_room"
        release_room_seat(agent.location, agent.name)
        agent.sandbox_name = None
        agent.sandbox_home_room = None
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
        state["sandbox_home_room"] = None
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
            "agent_runs": {},
            "skill_status": {},
            "partial_output": {},
            "tool_errors": [],
            "console": [],
            # 1 lobster → "single", 2+ → "coordinated" (each sees prior outputs).
            "mode": "single" if len(selected) == 1 else "coordinated",
            "policies": active_policies,
            "policy_snapshot": active_policies,
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
            await self._broadcast_team_task_started(run_id, sandbox_name, task, agents)
            await self._position_team_in_sandbox(run_id, sandbox_name, task, agents)
            results = await self._run_relay(run_id, sandbox_name, task, agents)
            for agent, result in results:
                await self._record_agent_result(run_id, sandbox_name, agent, result)
            await self._finish_run(run_id, sandbox_name, agents)
        except asyncio.CancelledError:
            await self._handle_cancellation(run_id, sandbox_name, agents)
        finally:
            self._run_tasks.pop(run_id, None)

    async def _broadcast_team_task_started(
        self,
        run_id: str,
        sandbox_name: str,
        task: str,
        agents: list[Agent],
    ) -> None:
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

    async def _position_team_in_sandbox(
        self,
        run_id: str,
        sandbox_name: str,
        task: str,
        agents: list[Agent],
    ) -> None:
        del run_id  # reserved for future per-position progress events
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
                "sandbox_home_room": agent.sandbox_home_room,
                "connect_command": agent.connect_command,
                "timestamp": datetime.now().isoformat(),
            })

    async def _run_relay(
        self,
        run_id: str,
        sandbox_name: str,
        task: str,
        agents: list[Agent],
    ) -> list[tuple[Agent, dict[str, Any]]]:
        """Coordinated relay: each lobster sees prior teammates' outputs so the
        team builds on its own work instead of duplicating it. Errors are
        contained per-lobster — one failure cannot stop the rest of the team."""
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
                results.append(
                    (
                        agent,
                        {
                            "success": False,
                            "output": f"{type(exc).__name__}: {exc}",
                            # Full traceback so the Task Monitor can render the real
                            # cause instead of just a one-line summary. Kept under
                            # "traceback" so frontend can show it in a collapsible.
                            "traceback": traceback.format_exc(),
                        },
                    )
                )
        return results

    async def _finish_run(
        self,
        run_id: str,
        sandbox_name: str,
        agents: list[Agent],
    ) -> None:
        self._reset_agents(agents)
        meta = self._run_meta.get(run_id)
        if meta:
            self._summarize_run_outcome(meta, agents)
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

    def _summarize_run_outcome(self, meta: dict[str, Any], agents: list[Agent]) -> None:
        """Attach an aggregate outcome without losing per-agent detail.

        ``status=finished`` means the relay lifecycle completed. ``outcome``
        answers whether the team actually succeeded.
        """

        agent_runs = meta.get("agent_runs")
        if not isinstance(agent_runs, dict):
            agent_runs = {}
        total = len(agents)
        succeeded_agents = [
            agent.name for agent in agents
            if bool((agent_runs.get(agent.name) or {}).get("success"))
        ]
        failed_agents = [
            agent.name for agent in agents
            if agent.name not in succeeded_agents
        ]
        success_count = len(succeeded_agents)
        error_count = len(failed_agents)
        if total == 0:
            outcome = "empty"
        elif success_count == total:
            outcome = "success"
        elif success_count == 0:
            outcome = "failed"
        else:
            outcome = "partial"

        meta["outcome"] = outcome
        meta["success_count"] = success_count
        meta["error_count"] = error_count
        meta["total_count"] = total
        meta["succeeded_agents"] = succeeded_agents
        meta["failed_agents"] = failed_agents
        if outcome == "success":
            meta["last_message"] = f"Run succeeded: {success_count}/{total} agents finished."
        elif outcome == "partial":
            meta["last_message"] = (
                f"Run finished with partial success: {success_count}/{total} agents succeeded; "
                f"{error_count} failed."
            )
        elif outcome == "failed":
            meta["last_message"] = f"Run failed: 0/{total} agents succeeded."
        else:
            meta["last_message"] = "Run finished with no agents."
        meta["last_update_at"] = datetime.now().isoformat()

    async def _handle_cancellation(
        self,
        run_id: str,
        sandbox_name: str,
        agents: list[Agent],
    ) -> None:
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

    def _move_agent_into_sandbox(self, agent: Agent, sandbox_name: str, task: str) -> None:
        target_room = self._home_room_for_sandbox(sandbox_name)
        if target_room:
            release_room_seat(agent.location, agent.name)
            agent.position = get_room_position(target_room, agent.name)
            agent.location = target_room
            agent.target_position = None
            self._office_state.update_agent_position(agent.name, target_room, agent.position)

        agent.sandbox_name = sandbox_name
        agent.sandbox_home_room = target_room
        agent.connect_command = f"nemoclaw {sandbox_name} connect"
        agent.current_task = task
        agent.state = AgentState.coding
        state = self._office_state.agent_states.setdefault(agent.name, {})
        state["state"] = AgentState.coding.value
        state["current_task"] = task
        state["sandbox_name"] = sandbox_name
        state["sandbox_home_room"] = target_room
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
            skills=list(agent.openclaw_skills),
            working_dir=f"{DEFAULT_RUNS_WORKDIR}/{run_id}/{agent.claw_id}",
            timeout_seconds=settings.openclaw_profile_timeout_seconds,
        )
        meta = self._run_meta.get(run_id)
        if meta is not None:
            skill_status = meta.setdefault("skill_status", {})
            skill_status[agent.name] = {
                "claw_id": agent.claw_id,
                "success": bool(ensure_result.get("success")),
                "requested": ensure_result.get("skills_requested", []),
                **(ensure_result.get("skill_status") or {}),
            }
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
        # Forward each stderr/stdout line to a sandbox_console WS event so
        # the Task Monitor can render a live trace of what OpenClaw's
        # subprocess is doing. Cheap, observable proof the run is real.
        async def emit_console(stream: str, line: str) -> None:
            timestamp = datetime.now().isoformat()
            meta = self._run_meta.get(run_id)
            if meta is not None:
                console = meta.setdefault("console", [])
                console.append({
                    "run_id": run_id,
                    "sandbox_name": sandbox_name,
                    "agent": agent.name,
                    "claw_id": agent.claw_id,
                    "stream": stream,
                    "line": line[:2000],
                    "timestamp": timestamp,
                })
                if len(console) > 1000:
                    del console[: len(console) - 1000]
            await self._broadcast({
                "type": "sandbox_console",
                "run_id": run_id,
                "sandbox_name": sandbox_name,
                "agent": agent.name,
                "claw_id": agent.claw_id,
                "stream": stream,
                "line": line[:2000],
                "timestamp": timestamp,
            })

        result = await run_openclaw(
            task,
            claw_id=agent.claw_id,
            sandbox_name=sandbox_name,
            working_dir=f"{DEFAULT_RUNS_WORKDIR}/{run_id}/{agent.claw_id}",
            timeout_seconds=settings.openclaw_turn_timeout_seconds,
            require_sandbox=True,
            display_name=agent.name,
            role_label=agent.role,
            personality=getattr(agent, "personality", None),
            tools=list(agent.tools),
            prior_turns=prior_turns or None,
            session_id=f"{run_id}-{agent.claw_id}",
            on_chunk=emit_console,
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

        diagnostics = result.get("diagnostics") if isinstance(result.get("diagnostics"), dict) else {}
        partial = str(result.get("partial_output") or diagnostics.get("partial_output") or "").strip()
        failure_detail = str(result.get("failure_detail") or diagnostics.get("failure_detail") or "").strip()
        raw_output = str(result.get("output") or "").strip()
        if not result.get("success") and failure_detail and failure_detail not in raw_output:
            raw_output = f"{failure_detail}\n\n{raw_output}" if raw_output else failure_detail
        if not result.get("success") and partial and partial not in raw_output:
            raw_output = f"{raw_output}\n\nPartial output:\n{partial}" if raw_output else f"Partial output:\n{partial}"

        # Surface attempted violations — when an agent tried to reach a tool /
        # host / file the sandbox blocked. Today these show up as substrings
        # in the OpenClaw subprocess output. If we see one, fire a visible
        # sandbox_violation event so the UI can render it as a red row.
        await self._detect_and_broadcast_violations(
            run_id=run_id,
            sandbox_name=sandbox_name,
            agent=agent,
            raw_output=raw_output,
        )

        # When the run blew up with a Python exception in _run_relay we get
        # both a short ``output`` and a full ``traceback``; splicing the
        # traceback in here gives the Task Monitor a real cause instead of
        # the one-line "TypeError: foo" stub.
        traceback_text = str(result.get("traceback") or "").strip()
        if traceback_text and traceback_text not in raw_output:
            raw_output = f"{raw_output}\n\nTraceback:\n{traceback_text}" if raw_output else f"Traceback:\n{traceback_text}"

        output = raw_output or "No visible response returned."
        # Larger cap when a traceback is present so the cause is actually visible.
        cap = 2000 if traceback_text else 700
        if len(output) > cap:
            output = output[: cap - 3].rstrip() + "..."

        status = "finished" if result.get("success") else "hit a sandbox error"
        meta = self._run_meta.get(run_id)
        if meta is not None:
            outputs = meta.setdefault("outputs", {})
            errors = meta.setdefault("errors", {})
            agent_runs = meta.setdefault("agent_runs", {})
            agent_runs[agent.name] = self._agent_run_diagnostics(agent, result)
            if partial:
                meta.setdefault("partial_output", {})[agent.name] = partial[:4000]
            tool_errors = result.get("tool_errors") or diagnostics.get("tool_errors") or []
            if isinstance(tool_errors, list) and tool_errors:
                aggregate = meta.setdefault("tool_errors", [])
                for entry in tool_errors:
                    if isinstance(entry, dict):
                        aggregate.append({"agent": agent.name, **entry})
                    else:
                        aggregate.append({"agent": agent.name, "error": str(entry)})
                if len(aggregate) > 50:
                    del aggregate[: len(aggregate) - 50]
            if result.get("success"):
                outputs[agent.name] = output
                errors.pop(agent.name, None)
            else:
                errors[agent.name] = output
                meta["failure_kind"] = meta.get("failure_kind") or result.get("failure_kind") or diagnostics.get("failure_kind") or "openclaw_failed"
                meta["failure_detail"] = meta.get("failure_detail") or failure_detail or output
                if result.get("timed_out") or diagnostics.get("timed_out"):
                    meta["timed_out"] = True
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
            "sandbox_home_room": agent.sandbox_home_room,
            "connect_command": agent.connect_command,
            "timestamp": datetime.now().isoformat(),
        })

    def _agent_run_diagnostics(self, agent: Agent, result: dict[str, Any]) -> dict[str, Any]:
        diagnostics = result.get("diagnostics") if isinstance(result.get("diagnostics"), dict) else {}
        return {
            "agent": agent.name,
            "claw_id": agent.claw_id,
            "success": bool(result.get("success")),
            "session_id": result.get("session_id"),
            "execution_mode": result.get("execution_mode"),
            "failure_kind": result.get("failure_kind") or diagnostics.get("failure_kind"),
            "failure_detail": result.get("failure_detail") or diagnostics.get("failure_detail"),
            "timed_out": bool(result.get("timed_out") or diagnostics.get("timed_out")),
            "partial_output": result.get("partial_output") or diagnostics.get("partial_output"),
            "tool_errors": result.get("tool_errors") or diagnostics.get("tool_errors") or [],
        }

    # Patterns that indicate an agent tried to invoke a tool / host / file
    # the sandbox or its per-agent filter denied. These are matched against
    # the raw OpenClaw subprocess output and surfaced over WS so the UI can
    # render them as visible "attempted violation" events.
    _VIOLATION_PATTERNS = [
        (r"blocked by allowlist", "Blocked by policy allowlist", "policy"),
        (r"connection refused|connect timed out|EHOSTUNREACH|ENETUNREACH",
         "Network endpoint refused", "policy"),
        (r"permission denied|EACCES|EPERM", "Permission denied (filesystem/process)", "policy"),
        (r"skill (?:not (?:installed|available)|filter|denied)",
         "Skill not in this agent's allowed set", "skill"),
        (r"tool .{0,40}? (?:denied|not allowed|disallowed)",
         "Tool call disallowed for this agent", "skill"),
        (r"unknown skill|skill .{0,40}? was not found",
         "Agent referenced a skill that isn't installed", "skill"),
        (r"could not resolve host|name or service not known",
         "DNS blocked at the sandbox boundary", "policy"),
    ]

    async def _detect_and_broadcast_violations(
        self,
        *,
        run_id: str,
        sandbox_name: str,
        agent: Agent,
        raw_output: str,
    ) -> None:
        """Scan an agent's output for refusal/denial signatures and report them.

        Best-effort regex on the raw subprocess output. A hit fires a
        `sandbox_violation` WS event with the matched snippet so the Task
        Monitor can render a red row. Doesn't gate or retry — purely
        observability.
        """
        if not raw_output:
            return
        import re

        seen: list[dict[str, str]] = []
        for pattern, label, kind in self._VIOLATION_PATTERNS:
            match = re.search(pattern, raw_output, re.IGNORECASE)
            if not match:
                continue
            # Grab a short snippet around the match for context.
            start = max(0, match.start() - 60)
            end = min(len(raw_output), match.end() + 60)
            snippet = raw_output[start:end].strip()
            if len(snippet) > 200:
                snippet = snippet[:197] + "..."
            seen.append({"label": label, "kind": kind, "snippet": snippet})

        if not seen:
            return

        meta = self._run_meta.get(run_id)
        if meta is not None:
            log = meta.setdefault("violations", [])
            for entry in seen:
                log.append({"agent": agent.name, **entry})

        for entry in seen:
            logger.warning(
                "Sandbox violation: sandbox=%s agent=%s kind=%s label=%s",
                sandbox_name, agent.name, entry["kind"], entry["label"],
            )
            await self._broadcast({
                "type": "sandbox_violation",
                "run_id": run_id,
                "sandbox_name": sandbox_name,
                "agent": agent.name,
                "claw_id": agent.claw_id,
                "kind": entry["kind"],
                "label": entry["label"],
                "snippet": entry["snippet"],
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
