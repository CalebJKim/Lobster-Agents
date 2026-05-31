#!/usr/bin/env python3
"""Safe end-to-end validation for the Lobster Agents demo.

The default path creates temporary lobster/crab profiles, validates sandbox
assignment, toggles one policy with restore, runs a two-lobster relay task,
then cleans up. Use --keep-agents when debugging failed UI state.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any


DEFAULT_BASE = "http://127.0.0.1:4454"


@dataclass
class Check:
    label: str
    ok: bool
    detail: Any = ""


@dataclass
class Context:
    base: str
    sandbox: str
    display: str
    stamp: str
    create_sandbox: bool
    keep_agents: bool
    skip_task: bool
    json_mode: bool
    task_timeout_seconds: int
    checks: list[Check] = field(default_factory=list)
    created_agents: list[str] = field(default_factory=list)
    before_policies: list[str] = field(default_factory=list)
    after_policies: list[str] = field(default_factory=list)
    brave_original: bool | None = None
    run_id: str | None = None
    started_at: float = field(default_factory=time.monotonic)

    @property
    def lobster_a(self) -> str:
        return f"Demo Lobster A {self.stamp}"

    @property
    def lobster_b(self) -> str:
        return f"Demo Lobster B {self.stamp}"

    @property
    def crab(self) -> str:
        return f"Demo Crab {self.stamp}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Lobster Agents demo E2E flow.")
    parser.add_argument("--base", default=DEFAULT_BASE, help="Frontend/proxy base URL.")
    parser.add_argument("--sandbox", help="Existing sandbox name to reuse.")
    parser.add_argument("--display", help="Display name when creating a sandbox.")
    parser.add_argument(
        "--create-sandbox",
        action="store_true",
        help="Create/provision the requested sandbox instead of requiring it to exist.",
    )
    parser.add_argument(
        "--keep-agents",
        action="store_true",
        help="Leave temporary profiles assigned/created for manual inspection.",
    )
    parser.add_argument(
        "--skip-task",
        action="store_true",
        help="Validate setup, profile creation, assignment, policies, and rules without running a relay task.",
    )
    parser.add_argument(
        "--task-timeout-seconds",
        type=int,
        default=1500,
        help="Maximum time to wait for the two-agent relay before failing and cleaning up.",
    )
    parser.add_argument("--json", action="store_true", help="Emit a machine-readable summary at the end.")
    return parser.parse_args()


def http(ctx: Context, method: str, path: str, body: dict[str, Any] | None = None, timeout: int = 30) -> tuple[int, dict[str, Any]]:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(ctx.base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode("utf-8", errors="replace")
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"raw": raw}
        return exc.code, parsed


def require(ctx: Context, label: str, ok: bool, detail: Any = "") -> None:
    ctx.checks.append(Check(label=label, ok=ok, detail=detail))
    if not ctx.json_mode:
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {label}")
        if detail:
            print(f"       {detail}")
    if not ok:
        raise SystemExit(1)


def q(value: str) -> str:
    return urllib.parse.quote(value)


def sandbox_brief(sandbox: dict[str, Any] | None) -> dict[str, Any] | None:
    if not sandbox:
        return None
    readiness = sandbox.get("readiness") if isinstance(sandbox.get("readiness"), dict) else {}
    return {
        "name": sandbox.get("name"),
        "display_name": sandbox.get("display_name"),
        "live": sandbox.get("live"),
        "phase": sandbox.get("phase"),
        "provider": sandbox.get("provider"),
        "model": sandbox.get("model"),
        "policies": sandbox.get("policies"),
        "readiness_ok": readiness.get("ok"),
        "readiness_issues": readiness.get("issues"),
    }


def run_brief(run: dict[str, Any] | None) -> dict[str, Any] | None:
    if not run:
        return None
    return {
        "run_id": run.get("run_id"),
        "phase": run.get("phase"),
        "status": run.get("status"),
        "outcome": run.get("outcome"),
        "running": run.get("running"),
        "last_message": run.get("last_message"),
        "success_count": run.get("success_count"),
        "total_count": run.get("total_count"),
    }


def rules_brief(rules: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": rules.get("ok"),
        "counts": rules.get("counts"),
        "error": rules.get("error"),
        "rule_count": len(rules.get("rules") or []),
    }


def active_run_for_sandbox(ctx: Context) -> dict[str, Any] | None:
    sandbox = find_sandbox(ctx, ctx.sandbox)
    run = (sandbox or {}).get("run_status")
    return run if isinstance(run, dict) else None


def cancel_active_run(ctx: Context) -> None:
    run = active_run_for_sandbox(ctx)
    if not run or not run.get("running"):
        return
    run_id = str(run.get("run_id") or "")
    if not run_id:
        return
    code, body = http(ctx, "POST", f"/sandboxes/{q(ctx.sandbox)}/task/{q(run_id)}/cancel", timeout=30)
    require(ctx, "cancel active run before cleanup", code == 200 and body.get("cancelled") is True, body)
    for _ in range(60):
        current = active_run_for_sandbox(ctx)
        if not (current and current.get("running")):
            return
        time.sleep(2)
    raise RuntimeError(f"Run {run_id} did not stop after cancel request")


def json_detail(value: Any) -> Any:
    if value in ("", None):
        return value
    if isinstance(value, (str, int, float, bool)):
        return value
    try:
        encoded = json.dumps(value, sort_keys=True, default=str)
    except TypeError:
        encoded = str(value)
    if len(encoded) > 2000:
        return encoded[:1997] + "..."
    try:
        return json.loads(encoded)
    except json.JSONDecodeError:
        return encoded


def find_sandbox(ctx: Context, name: str) -> dict[str, Any] | None:
    _, body = http(ctx, "GET", "/sandboxes", timeout=30)
    for sandbox in body.get("sandboxes", []):
        if isinstance(sandbox, dict) and sandbox.get("name") == name:
            return sandbox
    return None


def enabled_policy_names(ctx: Context, sandbox_name: str) -> list[str]:
    code, body = http(ctx, "GET", f"/sandboxes/{q(sandbox_name)}/policies", timeout=45)
    require(ctx, "policies endpoint responds", code == 200, body if code != 200 else "")
    return [p.get("name") for p in body.get("policies", []) if isinstance(p, dict) and p.get("enabled")]


def create_profile(ctx: Context, payload: dict[str, Any], label: str) -> dict[str, Any]:
    code, body = http(ctx, "POST", "/lobsters", payload)
    require(ctx, label, code == 200, body)
    name = str(payload["name"])
    ctx.created_agents.append(name)
    return body.get("agent") or body.get("lobster") or {}


def wait_for_live_sandbox(ctx: Context) -> dict[str, Any] | None:
    for _ in range(180):
        sandbox = find_sandbox(ctx, ctx.sandbox)
        if sandbox and sandbox.get("live"):
            return sandbox
        time.sleep(5)
    return find_sandbox(ctx, ctx.sandbox)


def restore_policy(ctx: Context) -> None:
    if ctx.brave_original is None:
        return
    code, body = http(ctx, "GET", f"/sandboxes/{q(ctx.sandbox)}/policies", timeout=45)
    if code != 200:
        return
    current_has_brave = any(
        isinstance(p, dict) and p.get("name") == "brave" and p.get("enabled")
        for p in body.get("policies", [])
    )
    if current_has_brave == ctx.brave_original:
        return
    code, body = http(ctx, "POST", f"/sandboxes/{q(ctx.sandbox)}/policies", {
        "preset": "brave",
        "enabled": ctx.brave_original,
        "dry_run": False,
    }, timeout=60)
    require(ctx, "restore brave policy", code == 200 and body.get("ok") is True, body)


def cleanup_agents(ctx: Context) -> None:
    if ctx.keep_agents:
        return
    cancel_active_run(ctx)
    http(ctx, "POST", f"/sandboxes/{q(ctx.sandbox)}/team", {"agent_names": []}, timeout=30)
    for name in ctx.created_agents:
        code, body = http(ctx, "DELETE", f"/lobsters/{q(name)}", timeout=30)
        require(ctx, f"delete temporary profile {name}", code == 200, body)


def run_flow(ctx: Context) -> None:
    if not ctx.json_mode:
        print("NemoClaw demo E2E")
        print(f"base={ctx.base}")
        print(f"sandbox={ctx.sandbox}")
        print(f"agents={ctx.lobster_a!r}, {ctx.lobster_b!r}, {ctx.crab!r}")

    code, health = http(ctx, "GET", "/health", timeout=15)
    components = health.get("components", {})
    require(ctx, "frontend proxy + backend health", code == 200 and health.get("ok") is True, health)
    require(ctx, "openshell health", components.get("openshell", {}).get("ok") is True)
    require(ctx, "nemoclaw health", components.get("nemoclaw", {}).get("ok") is True)
    require(ctx, "model loaded", components.get("llm", {}).get("model_loaded") is True)

    code, index = http(ctx, "GET", "/sandboxes", timeout=30)
    require(ctx, "sandboxes list loads", code == 200 and index.get("available") is True)
    live_count = sum(1 for s in index.get("sandboxes", []) if isinstance(s, dict) and s.get("live"))
    require(ctx, "at least one live sandbox exists", live_count > 0, f"live_count={live_count}")

    lobster = create_profile(ctx, {
        "archetype": "analyst",
        "name": ctx.lobster_a,
        "species": "lobster",
        "color": "#7c3aed",
        "appearance": {"headwear": "baseball_cap", "eyewear": "sunglasses"},
        "skills": [],
        "mission": "For demo validation, answer briefly and avoid web search unless explicitly asked.",
    }, "create accessorized lobster profile A")
    require(
        ctx,
        "lobster preserves color/accessories",
        lobster.get("color") == "#7c3aed"
        and lobster.get("appearance", {}).get("headwear") == "baseball_cap"
        and lobster.get("appearance", {}).get("eyewear") == "sunglasses",
        lobster,
    )

    lobster_b = create_profile(ctx, {
        "archetype": "writer",
        "name": ctx.lobster_b,
        "species": "lobster",
        "color": "#059669",
        "appearance": {
            "headwear": "generated",
            "eyewear": "none",
            "generated_headwear": {
                "kind": "wizard_hat",
                "label": "Wizard hat",
                "primary": "#6d28d9",
                "accent": "#facc15",
                "decorations": [{"type": "star", "color": "#facc15", "count": 5}],
            },
        },
        "skills": [],
        "mission": "For demo validation, answer briefly and avoid web search unless explicitly asked.",
    }, "create accessorized lobster profile B")
    require(
        ctx,
        "second lobster preserves generated headwear preset",
        lobster_b.get("color") == "#059669"
        and lobster_b.get("appearance", {}).get("headwear") == "generated"
        and lobster_b.get("appearance", {}).get("generated_headwear", {}).get("kind") == "wizard_hat",
        lobster_b,
    )

    crab = create_profile(ctx, {
        "archetype": "planner",
        "name": ctx.crab,
        "species": "crab",
        "color": "#2563eb",
        "appearance": {
            "headwear": "generated",
            "eyewear": "none",
            "generated_headwear": {
                "kind": "crown",
                "label": "Crown",
                "primary": "#f59e0b",
                "accent": "#38bdf8",
                "decorations": [{"type": "gem", "color": "#38bdf8", "count": 4}],
            },
        },
        "skills": [],
        "mission": "For demo validation, be concise. If Hermes is unavailable, report that clearly.",
    }, "create Hermes crab profile")
    require(
        ctx,
        "crab preserves species/runtime/color/accessory",
        crab.get("species") == "crab"
        and crab.get("runtime") == "hermes"
        and crab.get("color") == "#2563eb"
        and crab.get("appearance", {}).get("headwear") == "generated"
        and crab.get("appearance", {}).get("generated_headwear", {}).get("kind") == "crown",
        crab,
    )

    if ctx.create_sandbox:
        code, body = http(ctx, "POST", "/sandboxes", {
            "display_name": ctx.display,
            "sandbox_name": ctx.sandbox,
            "provision": True,
        }, timeout=35)
        require(ctx, "create/provision sandbox request accepted", code == 200 and body.get("status") in {"ok", "provisioning"}, body)
    else:
        existing = find_sandbox(ctx, ctx.sandbox)
        require(ctx, "using pre-created live sandbox", bool(existing), sandbox_brief(existing))

    sandbox = wait_for_live_sandbox(ctx)
    require(ctx, "sandbox becomes live", bool(sandbox and sandbox.get("live")), sandbox_brief(sandbox))

    code, body = http(ctx, "POST", f"/sandboxes/{q(ctx.sandbox)}/team", {
        "agent_names": [ctx.lobster_a, ctx.crab],
    }, timeout=30)
    require(ctx, "assign lobster + crab visual team to sandbox", code == 200, body)
    require(ctx, "assignment accepts crab profile", set(body.get("assignments", {}).get(ctx.sandbox, [])) == {ctx.lobster_a, ctx.crab}, body.get("assignments"))

    code, body = http(ctx, "POST", f"/sandboxes/{q(ctx.sandbox)}/team", {
        "agent_names": [ctx.lobster_a, ctx.lobster_b],
    }, timeout=30)
    require(ctx, "assign two OpenClaw lobsters for executable task", code == 200, body)
    require(ctx, "assignment includes executable team", set(body.get("assignments", {}).get(ctx.sandbox, [])) == {ctx.lobster_a, ctx.lobster_b}, body.get("assignments"))

    ctx.before_policies = enabled_policy_names(ctx, ctx.sandbox)
    ctx.brave_original = "brave" in ctx.before_policies
    target_enabled = "brave" not in ctx.before_policies
    code, dry = http(ctx, "POST", f"/sandboxes/{q(ctx.sandbox)}/policies", {
        "preset": "brave",
        "enabled": target_enabled,
        "dry_run": True,
    }, timeout=45)
    require(ctx, "policy dry-run works", code == 200 and dry.get("ok") is True, dry)

    code, applied = http(ctx, "POST", f"/sandboxes/{q(ctx.sandbox)}/policies", {
        "preset": "brave",
        "enabled": target_enabled,
        "dry_run": False,
    }, timeout=60)
    require(ctx, "policy apply works", code == 200 and applied.get("ok") is True, applied)
    ctx.after_policies = enabled_policy_names(ctx, ctx.sandbox)
    require(ctx, "policy state reflects applied brave toggle", ("brave" in ctx.after_policies) is target_enabled, ctx.after_policies)

    code, rules = http(ctx, "GET", f"/sandboxes/{q(ctx.sandbox)}/network-rules?status=all", timeout=45)
    require(ctx, "OpenShell network rules endpoint loads", code == 200 and "rules" in rules, rules_brief(rules))

    if ctx.skip_task:
        return

    task = (
        "Demo validation: each assigned profile reply in one short sentence confirming "
        "the NemoClaw sandbox team works. Do not use web search or external network."
    )
    code, body = http(ctx, "POST", f"/sandboxes/{q(ctx.sandbox)}/task", {
        "task": task,
        "agent_names": [ctx.lobster_a, ctx.lobster_b],
    }, timeout=35)
    require(ctx, "start sandbox team task", code == 200 and body.get("run_id"), body)
    ctx.run_id = str(body["run_id"])
    if not ctx.json_mode:
        print(f"run_id={ctx.run_id}")

    finished = False
    final_run: dict[str, Any] | None = None
    started_wait = time.monotonic()
    poll_index = 0
    while time.monotonic() - started_wait < ctx.task_timeout_seconds:
        current = find_sandbox(ctx, ctx.sandbox)
        run = (current or {}).get("run_status") or {}
        if run.get("run_id") == ctx.run_id:
            final_run = run
            if not ctx.json_mode:
                print(
                    f"poll {poll_index:02d}: phase={run.get('phase')} running={run.get('running')} "
                    f"active={run.get('current_agent')} latest={(run.get('last_message') or '')[:80]}"
                )
            if not run.get("running") and run.get("phase") == "result":
                finished = True
                break
            poll_index += 1
        time.sleep(5)
    require(ctx, "sandbox team task reaches result phase", finished, run_brief(final_run))

    code, diag = http(ctx, "GET", f"/sandboxes/{q(ctx.sandbox)}/tasks/{q(ctx.run_id)}/diagnostics", timeout=30)
    require(ctx, "diagnostics endpoint returns run", code == 200 and diag.get("run_id") == ctx.run_id, diag)
    per_agent = diag.get("per_agent_results") or diag.get("agent_runs") or {}
    require(ctx, "diagnostics include both assigned profiles", ctx.lobster_a in per_agent and ctx.lobster_b in per_agent, per_agent.keys())
    require(ctx, "OpenClaw lobster A completed", per_agent.get(ctx.lobster_a, {}).get("success") is True, per_agent.get(ctx.lobster_a))
    require(ctx, "OpenClaw lobster B completed", per_agent.get(ctx.lobster_b, {}).get("success") is True, per_agent.get(ctx.lobster_b))


def emit_json(ctx: Context, ok: bool) -> None:
    passed = sum(1 for check in ctx.checks if check.ok)
    failed = sum(1 for check in ctx.checks if not check.ok)
    print(json.dumps({
        "ok": ok,
        "base": ctx.base,
        "sandbox": ctx.sandbox,
        "run_id": ctx.run_id,
        "created_agents": ctx.created_agents,
        "duration_seconds": round(time.monotonic() - ctx.started_at, 2),
        "passed": passed,
        "failed": failed,
        "checks": [
            {"label": check.label, "ok": check.ok, "detail": json_detail(check.detail)}
            for check in ctx.checks
        ],
    }, indent=2, sort_keys=True))


def main() -> int:
    args = parse_args()
    stamp = time.strftime("%m%d%H%M%S")
    sandbox = args.sandbox or f"nemoclaw-demo-e2e-{stamp}"
    display = args.display or f"Demo E2E {stamp}"
    ctx = Context(
        base=args.base.rstrip("/"),
        sandbox=sandbox,
        display=display,
        stamp=stamp,
        create_sandbox=args.create_sandbox,
        keep_agents=args.keep_agents,
        skip_task=args.skip_task,
        json_mode=args.json,
        task_timeout_seconds=max(30, args.task_timeout_seconds),
    )
    ok = False
    exit_code = 0
    try:
        run_flow(ctx)
        ok = True
    except SystemExit as exc:
        exit_code = int(exc.code or 1)
    except Exception as exc:
        ctx.checks.append(Check("unexpected exception", False, f"{type(exc).__name__}: {exc}"))
        if not ctx.json_mode:
            print(f"[FAIL] unexpected exception: {exc}", file=sys.stderr)
        exit_code = 1

    cleanup_error: Exception | None = None
    try:
        restore_policy(ctx)
        cleanup_agents(ctx)
    except Exception as exc:
        cleanup_error = exc
        ctx.checks.append(Check("cleanup/restore", False, f"{type(exc).__name__}: {exc}"))
        if not ctx.json_mode:
            print(f"[FAIL] cleanup/restore: {exc}", file=sys.stderr)

    if ctx.json_mode:
        emit_json(ctx, ok and cleanup_error is None)
    elif ok and cleanup_error is None:
        print("ALL DEMO E2E CHECKS PASSED")

    if cleanup_error is not None:
        return 1
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
