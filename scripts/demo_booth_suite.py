#!/usr/bin/env python3
"""Rigorous demo-booth validation for Lobster Agents.

This is broader than scripts/demo_e2e.py. It runs the kinds of things a
five-minute booth visitor may try: visual profile creation, assignment edge
cases, policy toggles, missing credentials, non-Brave network denial, report
writing, coding/website output, and OpenClaw skill readiness.

The suite intentionally treats some results as WARN rather than FAIL. A WARN
means the app surfaced the truth clearly but the workflow is not a polished
demo story yet, for example "coding-agent needs setup" or "reporting is
reliable but too slow for a 5-minute booth interaction."
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
from pathlib import Path
from typing import Any, Literal


DEFAULT_BASE = "http://127.0.0.1:4454"
REPORT_DIR = Path("reports")

Status = Literal["pass", "warn", "fail"]


@dataclass
class Scenario:
    name: str
    status: Status
    duration_seconds: float
    evidence: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    run_id: str | None = None


@dataclass
class Context:
    base: str
    sandbox: str
    stamp: str
    task_timeout_seconds: int
    keep_agents: bool
    json_mode: bool
    created_agents: list[str] = field(default_factory=list)
    brave_original: bool | None = None
    npm_original: bool | None = None
    started_at: float = field(default_factory=time.monotonic)
    scenarios: list[Scenario] = field(default_factory=list)

    def agent_name(self, kind: str) -> str:
        return f"Booth {kind} {self.stamp}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run broad Lobster Agents demo-booth validation.")
    parser.add_argument("--base", default=DEFAULT_BASE, help="Frontend/proxy base URL.")
    parser.add_argument("--sandbox", default="nemoclaw-demo-e2e-0530182359", help="Live NemoClaw sandbox to use.")
    parser.add_argument("--task-timeout-seconds", type=int, default=900, help="Timeout per real OpenClaw task.")
    parser.add_argument("--keep-agents", action="store_true", help="Leave temporary booth profiles behind.")
    parser.add_argument("--json", action="store_true", help="Emit final JSON only.")
    parser.add_argument(
        "--scenarios",
        default="all",
        help=(
            "Comma-separated subset: readiness,profiles,edges,policies,report,coding,"
            "skill,denial,web,reset. Default all."
        ),
    )
    return parser.parse_args()


def q(value: str) -> str:
    return urllib.parse.quote(value)


def http(ctx: Context, method: str, path: str, body: dict[str, Any] | None = None, timeout: int = 45) -> tuple[int, dict[str, Any]]:
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


def compact(value: Any, limit: int = 1400) -> Any:
    if value in ("", None) or isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, str):
        return value[:limit].rstrip() + ("..." if len(value) > limit else "")
    try:
        text = json.dumps(value, sort_keys=True, default=str)
    except TypeError:
        text = str(value)
    if len(text) > limit:
        return text[: limit - 3].rstrip() + "..."
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def add_scenario(ctx: Context, scenario: Scenario) -> None:
    ctx.scenarios.append(scenario)
    if not ctx.json_mode:
        print(f"[{scenario.status.upper()}] {scenario.name} ({scenario.duration_seconds:.1f}s)")
        if scenario.run_id:
            print(f"       run_id={scenario.run_id}")
        for note in scenario.notes[:4]:
            print(f"       {note}")


def scenario_timer() -> float:
    return time.monotonic()


def scenario_result(
    name: str,
    start: float,
    status: Status,
    evidence: dict[str, Any] | None = None,
    notes: list[str] | None = None,
    run_id: str | None = None,
) -> Scenario:
    return Scenario(
        name=name,
        status=status,
        duration_seconds=round(time.monotonic() - start, 2),
        evidence=evidence or {},
        notes=notes or [],
        run_id=run_id,
    )


def find_sandbox(ctx: Context) -> dict[str, Any] | None:
    code, body = http(ctx, "GET", "/sandboxes", timeout=45)
    if code != 200:
        return None
    for sandbox in body.get("sandboxes", []):
        if isinstance(sandbox, dict) and sandbox.get("name") == ctx.sandbox:
            return sandbox
    return None


def active_run(ctx: Context) -> dict[str, Any] | None:
    sandbox = find_sandbox(ctx)
    run = (sandbox or {}).get("run_status")
    return run if isinstance(run, dict) else None


def cancel_active_run(ctx: Context) -> None:
    run = active_run(ctx)
    if not run or not run.get("running"):
        return
    run_id = str(run.get("run_id") or "")
    if not run_id:
        return
    http(ctx, "POST", f"/sandboxes/{q(ctx.sandbox)}/task/{q(run_id)}/cancel", timeout=45)
    for _ in range(90):
        current = active_run(ctx)
        if not (current and current.get("running")):
            return
        time.sleep(2)


def profile_brief(profile: dict[str, Any]) -> dict[str, Any]:
    appearance = profile.get("appearance") if isinstance(profile.get("appearance"), dict) else {}
    generated = appearance.get("generated_headwear") if isinstance(appearance.get("generated_headwear"), dict) else {}
    return {
        "name": profile.get("name"),
        "species": profile.get("species"),
        "runtime": profile.get("runtime"),
        "role": profile.get("role"),
        "color": profile.get("color"),
        "headwear": appearance.get("headwear"),
        "generated_headwear_kind": generated.get("kind"),
        "eyewear": appearance.get("eyewear"),
        "skills": profile.get("openclaw_skills") or [],
    }


def create_profile(ctx: Context, payload: dict[str, Any]) -> dict[str, Any]:
    code, body = http(ctx, "POST", "/lobsters", payload, timeout=45)
    if code != 200:
        raise RuntimeError(f"create profile failed ({code}): {body}")
    name = str(payload["name"])
    ctx.created_agents.append(name)
    return body.get("agent") or body.get("lobster") or {}


def delete_profile(ctx: Context, name: str) -> dict[str, Any]:
    code, body = http(ctx, "DELETE", f"/lobsters/{q(name)}", timeout=45)
    return {"code": code, "body": body}


def assign_team(ctx: Context, names: list[str]) -> tuple[int, dict[str, Any]]:
    return http(ctx, "POST", f"/sandboxes/{q(ctx.sandbox)}/team", {"agent_names": names}, timeout=45)


def policies(ctx: Context) -> tuple[int, dict[str, Any]]:
    return http(ctx, "GET", f"/sandboxes/{q(ctx.sandbox)}/policies", timeout=60)


def enabled_policy_names(body: dict[str, Any]) -> list[str]:
    return [
        str(p.get("name"))
        for p in body.get("policies", [])
        if isinstance(p, dict) and p.get("enabled") and p.get("name")
    ]


def set_policy(ctx: Context, preset: str, enabled: bool, dry_run: bool) -> tuple[int, dict[str, Any]]:
    return http(
        ctx,
        "POST",
        f"/sandboxes/{q(ctx.sandbox)}/policies",
        {"preset": preset, "enabled": enabled, "dry_run": dry_run},
        timeout=75,
    )


def diagnostics_brief(diag: dict[str, Any]) -> dict[str, Any]:
    run_status = diag.get("run_status") if isinstance(diag.get("run_status"), dict) else {}
    agent_runs = diag.get("agent_runs") if isinstance(diag.get("agent_runs"), dict) else {}
    outputs = run_status.get("outputs") if isinstance(run_status.get("outputs"), dict) else {}
    errors = run_status.get("errors") if isinstance(run_status.get("errors"), dict) else {}
    skill_status = diag.get("skill_status") if isinstance(diag.get("skill_status"), dict) else {}
    tool_errors = diag.get("tool_errors") if isinstance(diag.get("tool_errors"), list) else []
    violations = diag.get("violations") if isinstance(diag.get("violations"), list) else []
    return {
        "run_id": diag.get("run_id"),
        "outcome": run_status.get("outcome"),
        "status": run_status.get("status"),
        "phase": run_status.get("phase"),
        "success_count": run_status.get("success_count"),
        "total_count": run_status.get("total_count"),
        "failure_kind": diag.get("failure_kind"),
        "timed_out": diag.get("timed_out"),
        "agents": {
            name: {
                "success": result.get("success") if isinstance(result, dict) else None,
                "failure_kind": result.get("failure_kind") if isinstance(result, dict) else None,
                "partial": compact(result.get("partial_output"), 500) if isinstance(result, dict) else None,
            }
            for name, result in agent_runs.items()
        },
        "outputs": {name: compact(text, 700) for name, text in outputs.items()},
        "errors": {name: compact(text, 700) for name, text in errors.items()},
        "skill_status": compact(skill_status, 1200),
        "tool_error_count": len(tool_errors),
        "violation_count": len(violations),
    }


def run_task(
    ctx: Context,
    *,
    name: str,
    agent_names: list[str],
    task: str,
    expected: str = "success",
    timeout_seconds: int | None = None,
) -> Scenario:
    start = scenario_timer()
    timeout = timeout_seconds or ctx.task_timeout_seconds
    code, assigned = assign_team(ctx, agent_names)
    if code != 200:
        return scenario_result(name, start, "fail", {"assign": assigned}, [f"Could not assign team: HTTP {code}"])
    code, body = http(
        ctx,
        "POST",
        f"/sandboxes/{q(ctx.sandbox)}/task",
        {"task": task, "agent_names": agent_names},
        timeout=60,
    )
    if code != 200 or not body.get("run_id"):
        return scenario_result(name, start, "fail", {"start": body}, [f"Could not start task: HTTP {code}"])
    run_id = str(body["run_id"])
    finished = False
    final_run: dict[str, Any] | None = None
    waited = 0.0
    while waited < timeout:
        sandbox = find_sandbox(ctx)
        run = (sandbox or {}).get("run_status") or {}
        if run.get("run_id") == run_id:
            final_run = run
            if not run.get("running") and run.get("phase") == "result":
                finished = True
                break
        time.sleep(5)
        waited += 5
    if not finished:
        http(ctx, "POST", f"/sandboxes/{q(ctx.sandbox)}/task/{q(run_id)}/cancel", timeout=45)
        return scenario_result(
            name,
            start,
            "fail",
            {"run": compact(final_run, 1200)},
            [f"Task did not finish within {timeout}s; cancellation requested."],
            run_id,
        )
    code, diag = http(ctx, "GET", f"/sandboxes/{q(ctx.sandbox)}/tasks/{q(run_id)}/diagnostics", timeout=60)
    if code != 200:
        return scenario_result(name, start, "fail", {"diagnostics": diag}, [f"Diagnostics failed: HTTP {code}"], run_id)
    brief = diagnostics_brief(diag)
    outcome = brief.get("outcome")
    if expected == "success" and outcome != "success":
        return scenario_result(name, start, "fail", brief, [f"Expected success, got {outcome}."], run_id)
    return scenario_result(name, start, "pass", brief, [f"Run completed with outcome={outcome}."], run_id)


def scenario_readiness(ctx: Context) -> Scenario:
    start = scenario_timer()
    code, health = http(ctx, "GET", "/health", timeout=30)
    code_ready, ready = http(ctx, "GET", f"/demo/readiness?sandbox_name={q(ctx.sandbox)}", timeout=75)
    ok = code == 200 and health.get("ok") is True and code_ready == 200 and ready.get("ok") is True
    status: Status = "pass" if ok else "fail"
    summary = ready.get("summary", {}) if isinstance(ready, dict) else {}
    notes = [
        f"Health ok={health.get('ok')} failing={health.get('failing')}",
        f"Readiness summary ok={summary.get('ok')} warn={summary.get('warn')} fail={summary.get('fail')}",
    ]
    return scenario_result("readiness and live stack", start, status, {"health": compact(health), "readiness": compact(ready)}, notes)


def scenario_profiles(ctx: Context) -> Scenario:
    start = scenario_timer()
    profiles = [
        create_profile(ctx, {
            "archetype": "researcher",
            "name": ctx.agent_name("Researcher"),
            "species": "lobster",
            "color": "#06b6d4",
            "appearance": {"headwear": "generated", "eyewear": "sunglasses", "generated_headwear": {
                "kind": "party_hat", "label": "Party hat", "primary": "#ef4444", "accent": "#facc15",
                "decorations": [{"type": "dot", "color": "#facc15", "count": 6}],
            }},
            "skills": [],
            "mission": "Booth validation: be concise, factual, and avoid web search unless explicitly asked.",
        }),
        create_profile(ctx, {
            "archetype": "writer",
            "name": ctx.agent_name("Writer"),
            "species": "lobster",
            "color": "#8b5cf6",
            "appearance": {"headwear": "generated", "eyewear": "none", "generated_headwear": {
                "kind": "wizard_hat", "label": "Wizard hat", "primary": "#6d28d9", "accent": "#facc15",
                "decorations": [{"type": "star", "color": "#facc15", "count": 5}],
            }},
            "skills": [],
            "mission": "Booth validation: synthesize teammate output into concise demo-ready prose.",
        }),
        create_profile(ctx, {
            "archetype": "coder",
            "name": ctx.agent_name("Coder"),
            "species": "lobster",
            "color": "#10b981",
            "appearance": {"headwear": "generated", "eyewear": "sunglasses", "generated_headwear": {
                "kind": "beanie", "label": "Beanie", "primary": "#0f766e", "accent": "#a7f3d0",
                "decorations": [{"type": "band", "color": "#a7f3d0", "count": 1}],
            }},
            "skills": [],
            "mission": "Booth validation: create small frontend artifacts and report exact files or setup gaps.",
        }),
        create_profile(ctx, {
            "archetype": "coder",
            "name": ctx.agent_name("Skill Coder"),
            "species": "lobster",
            "color": "#14b8a6",
            "appearance": {"headwear": "generated", "eyewear": "none", "generated_headwear": {
                "kind": "beanie", "label": "Beanie", "primary": "#115e59", "accent": "#99f6e4",
                "decorations": [{"type": "band", "color": "#99f6e4", "count": 1}],
            }},
            "skills": ["coding-agent"],
            "mission": "Booth validation: report coding-agent skill readiness truthfully.",
        }),
        create_profile(ctx, {
            "archetype": "critic",
            "name": ctx.agent_name("Critic"),
            "species": "lobster",
            "color": "#f59e0b",
            "appearance": {"headwear": "generated", "eyewear": "none", "generated_headwear": {
                "kind": "top_hat", "label": "Top hat", "primary": "#111827", "accent": "#f59e0b",
                "decorations": [{"type": "band", "color": "#f59e0b", "count": 1}],
            }},
            "skills": [],
            "mission": "Booth validation: find risks, missing proof, and unclear claims.",
        }),
        create_profile(ctx, {
            "archetype": "planner",
            "name": ctx.agent_name("Crab"),
            "species": "crab",
            "color": "#2563eb",
            "appearance": {"headwear": "generated", "eyewear": "none", "generated_headwear": {
                "kind": "crown", "label": "Crown", "primary": "#f59e0b", "accent": "#38bdf8",
                "decorations": [{"type": "gem", "color": "#38bdf8", "count": 4}],
            }},
            "skills": [],
            "mission": "Booth validation: be visual unless Hermes runtime is configured.",
        }),
    ]
    code, body = assign_team(ctx, [ctx.agent_name("Researcher"), ctx.agent_name("Crab")])
    ok = code == 200 and set(body.get("assignments", {}).get(ctx.sandbox, [])) == {
        ctx.agent_name("Researcher"), ctx.agent_name("Crab")
    }
    evidence = {"profiles": [profile_brief(p) for p in profiles], "assignment": compact(body)}
    notes = ["Created accessorized lobsters plus a Hermes crab.", "Assigned lobster+crab visual team."]
    return scenario_result("profile builder and crab visual assignment", start, "pass" if ok else "fail", evidence, notes)


def scenario_edge_cases(ctx: Context) -> Scenario:
    start = scenario_timer()
    checks: dict[str, Any] = {}
    code, body = assign_team(ctx, ["Definitely Missing Booth Agent"])
    checks["unknown_agent_assignment"] = {"code": code, "body": body}
    code_empty, body_empty = http(ctx, "POST", f"/sandboxes/{q(ctx.sandbox)}/task", {"task": "   "}, timeout=45)
    checks["empty_task"] = {"code": code_empty, "body": body_empty}
    assign_team(ctx, [ctx.agent_name("Researcher")])
    code_bad, body_bad = http(
        ctx,
        "POST",
        f"/sandboxes/{q(ctx.sandbox)}/task",
        {"task": "This should not start because requested agent is not assigned.", "agent_names": [ctx.agent_name("Writer")]},
        timeout=45,
    )
    checks["unassigned_requested_agent"] = {"code": code_bad, "body": body_bad}
    assign_team(ctx, [])
    code_none, body_none = http(
        ctx,
        "POST",
        f"/sandboxes/{q(ctx.sandbox)}/task",
        {"task": "This should not start because no agents are assigned."},
        timeout=45,
    )
    checks["no_assigned_agents"] = {"code": code_none, "body": body_none}
    ok = (
        code == 404
        and code_empty == 400
        and code_bad == 400
        and code_none == 400
    )
    notes = [
        "Unknown profiles, empty tasks, unassigned requested agents, and empty teams are rejected before starting runs.",
    ]
    return scenario_result("run safety edge cases", start, "pass" if ok else "fail", checks, notes)


def scenario_policies(ctx: Context) -> Scenario:
    start = scenario_timer()
    code, before = policies(ctx)
    if code != 200:
        return scenario_result("NemoClaw policy toggles beyond Brave", start, "fail", {"policies": before}, ["Policies endpoint failed."])
    enabled = enabled_policy_names(before)
    ctx.brave_original = "brave" in enabled
    ctx.npm_original = "npm" in enabled
    target = not ctx.npm_original
    code_dry, dry = set_policy(ctx, "npm", target, True)
    code_apply, applied = set_policy(ctx, "npm", target, False)
    code_after, after = policies(ctx)
    restored_code, restored = set_policy(ctx, "npm", bool(ctx.npm_original), False)
    code_rules, rules = http(ctx, "GET", f"/sandboxes/{q(ctx.sandbox)}/network-rules?status=all", timeout=60)
    after_enabled = enabled_policy_names(after) if code_after == 200 else []
    ok = (
        code_dry == 200 and dry.get("ok") is True
        and code_apply == 200 and applied.get("ok") is True
        and (("npm" in after_enabled) is target)
        and restored_code == 200 and restored.get("ok") is True
        and code_rules == 200 and "rules" in rules
    )
    evidence = {
        "before_enabled": enabled,
        "dry_run": compact(dry),
        "applied": compact(applied),
        "after_enabled": after_enabled,
        "restored": compact(restored),
        "network_rule_counts": rules.get("counts") if isinstance(rules, dict) else None,
    }
    return scenario_result(
        "NemoClaw npm policy toggle and OpenShell rules",
        start,
        "pass" if ok else "fail",
        evidence,
        ["Toggled npm with dry-run/apply/restore; this validates a non-Brave preset path."],
    )


def scenario_report(ctx: Context) -> Scenario:
    task = (
        "Booth demo report workflow. Do not use tools, files, shell, browser, web_search, or external network. "
        "Researcher: answer with one sentence naming two benefits of sandboxed agent teams. "
        "Writer: build on the prior turn and produce a visitor-facing mini report with a title, three bullets, "
        "and one risk/mitigation. Keep your final answer under 90 words."
    )
    result = run_task(
        ctx,
        name="collaborative report writing",
        agent_names=[ctx.agent_name("Researcher"), ctx.agent_name("Writer")],
        task=task,
        expected="success",
    )
    if result.status == "pass" and result.duration_seconds > 300:
        result.status = "warn"
        result.notes.append("Workflow is reliable but too slow for a 5-minute booth interaction; use Relay Check as the live path.")
    return result


def scenario_coding(ctx: Context) -> Scenario:
    task = (
        "Coding booth workflow. Do not use web search. In your working directory, create a tiny static website "
        "for a Lobster Agents demo with index.html and styles.css. The page should explain sandboxes, policies, "
        "and a lobster/crab team in visitor-friendly language. After creating files, report exact filenames, "
        "whether a browser-shareable URL is available in this UI, and one command someone would run to preview it."
    )
    result = run_task(
        ctx,
        name="coding workflow static website",
        agent_names=[ctx.agent_name("Coder")],
        task=task,
        expected="success",
        timeout_seconds=max(ctx.task_timeout_seconds, 1100),
    )
    if result.run_id:
        code, artifacts = http(
            ctx,
            "GET",
            f"/sandboxes/{q(ctx.sandbox)}/tasks/{q(result.run_id)}/artifacts",
            timeout=45,
        )
        result.evidence["artifacts"] = artifacts if code == 200 else {"code": code, "body": artifacts}
    text = json.dumps(result.evidence, sort_keys=True).lower()
    if result.status == "pass" and "index.html" not in text and "html" not in text:
        result.status = "warn"
        result.notes.append("The coding run succeeded but did not clearly report an HTML artifact.")
    artifact_files = result.evidence.get("artifacts", {}).get("files", []) if isinstance(result.evidence.get("artifacts"), dict) else []
    has_preview_artifact = any(
        isinstance(item, dict) and item.get("kind") == "html" and item.get("url")
        for item in artifact_files
    )
    if result.status == "pass" and not has_preview_artifact:
        result.status = "warn"
        result.notes.append("The run created/described files but the app did not expose a previewable HTML artifact URL.")
    if result.status == "pass" and result.duration_seconds > 300:
        result.status = "warn"
        result.notes.append("Coding workflow is reliable but too slow for a 5-minute booth interaction.")
    return result


def scenario_skill(ctx: Context) -> Scenario:
    task = (
        "Skill readiness workflow. Do not delegate to other agents and do not use web search. "
        "Inspect your available OpenClaw skills and report whether the coding-agent skill is ready, "
        "needs setup, or failed to install. Keep the answer under 120 words."
    )
    result = run_task(
        ctx,
        name="coding-agent skill readiness",
        agent_names=[ctx.agent_name("Skill Coder")],
        task=task,
        expected="success",
        timeout_seconds=max(ctx.task_timeout_seconds, 1100),
    )
    skill_json = json.dumps(result.evidence.get("skill_status", {}), sort_keys=True).lower()
    if "coding-agent" not in skill_json:
        result.status = "warn" if result.status == "pass" else result.status
        result.notes.append("Skill status did not include coding-agent; Build a Claw may show requested skill without live readiness proof.")
    elif "needs_setup" in skill_json or "install_failed" in skill_json:
        result.status = "warn"
        result.notes.append("coding-agent is discoverable/requested but not a polished out-of-box execution demo yet.")
    if result.status == "pass" and result.duration_seconds > 300:
        result.status = "warn"
        result.notes.append("Skill-readiness workflow is reliable but too slow for a 5-minute booth interaction.")
    return result


def scenario_denial(ctx: Context) -> Scenario:
    before_code, before = http(ctx, "GET", f"/sandboxes/{q(ctx.sandbox)}/network-rules?status=all", timeout=60)
    before_counts = before.get("counts", {}) if before_code == 200 else {}
    task = (
        "Policy denial workflow. Do not use web_search. Try a direct outbound request to https://example.com "
        "from inside the sandbox using an appropriate shell/network command. If OpenShell denies it, report the "
        "exact denial and stop. If it is allowed, say allowed and explain why this is surprising."
    )
    result = run_task(
        ctx,
        name="OpenShell network denial recommendation",
        agent_names=[ctx.agent_name("Researcher")],
        task=task,
        expected="success",
        timeout_seconds=max(ctx.task_timeout_seconds, 1000),
    )
    after_code, after = http(ctx, "GET", f"/sandboxes/{q(ctx.sandbox)}/network-rules?status=all", timeout=60)
    after_counts = after.get("counts", {}) if after_code == 200 else {}
    result.evidence["network_rules_before"] = before_counts
    result.evidence["network_rules_after"] = after_counts
    text = json.dumps(result.evidence, sort_keys=True).lower()
    if result.status == "pass" and not any(marker in text for marker in ["denied", "blocked", "pending", "policy", "openshell"]):
        result.status = "warn"
        result.notes.append("The run succeeded but did not clearly demonstrate a denied outbound request.")
    return result


def scenario_web_credential(ctx: Context) -> Scenario:
    start = scenario_timer()
    code, ready = http(ctx, "GET", f"/demo/readiness?sandbox_name={q(ctx.sandbox)}", timeout=75)
    credential_checks = (
        ready.get("policy_snapshot", {}).get("credential_checks", [])
        if isinstance(ready, dict) else []
    )
    missing = [
        check for check in credential_checks
        if isinstance(check, dict) and check.get("status") == "missing"
    ]
    if code == 200 and any(check.get("name") == "BRAVE_API_KEY" for check in missing):
        return scenario_result(
            "web/deep-research credential guard",
            start,
            "pass",
            {"readiness": {"missing": missing}, "task_guard": "UI should block external web tasks when BRAVE_API_KEY is missing."},
            ["BRAVE_API_KEY is missing; booth should use local/no-web research or configure Brave before external research demos."],
        )

    task = (
        "Web credential workflow. Use web_search for NVIDIA GB300, then answer in one sentence. "
        "If web_search fails, report the exact missing credential or tool error."
    )
    result = run_task(
        ctx,
        name="web search missing credential visibility",
        agent_names=[ctx.agent_name("Researcher")],
        task=task,
        expected="success",
        timeout_seconds=min(max(ctx.task_timeout_seconds, 360), 420),
    )
    text = json.dumps(result.evidence, sort_keys=True).lower()
    if any(marker in text for marker in ["brave_api_key", "missing_brave", "credential_missing"]):
        result.status = "pass"
        result.notes.append("Missing Brave credential surfaced clearly.")
    elif result.status == "pass":
        result.status = "warn"
        result.notes.append("The run did not clearly surface the expected Brave credential issue.")
    return result


def scenario_reset(ctx: Context) -> Scenario:
    start = scenario_timer()
    code, body = assign_team(ctx, [ctx.agent_name("Researcher"), ctx.agent_name("Writer")])
    code_clear, clear_body = http(ctx, "POST", f"/sandboxes/{q(ctx.sandbox)}/clear", timeout=75)
    code_rules, rules = http(ctx, "GET", f"/sandboxes/{q(ctx.sandbox)}/network-rules?status=all", timeout=60)
    # Reassign profiles because clear should not delete user-created profiles.
    code_assign_again, assign_again = assign_team(ctx, [ctx.agent_name("Researcher")])
    ok = code == 200 and code_clear == 200 and code_rules == 200 and code_assign_again == 200
    evidence = {
        "initial_assign": compact(body),
        "clear": compact(clear_body),
        "network_rule_counts_after_clear": rules.get("counts") if isinstance(rules, dict) else None,
        "reassign_after_clear": compact(assign_again),
    }
    return scenario_result(
        "sandbox clear/reset keeps policy rule state separate",
        start,
        "pass" if ok else "fail",
        evidence,
        ["Clear completed and profiles could be reassigned; OpenShell network rules remained separately visible."],
    )


def restore_policies(ctx: Context) -> None:
    if ctx.npm_original is not None:
        set_policy(ctx, "npm", bool(ctx.npm_original), False)
    if ctx.brave_original is not None:
        set_policy(ctx, "brave", bool(ctx.brave_original), False)


def cleanup(ctx: Context) -> list[dict[str, Any]]:
    cleanup_results: list[dict[str, Any]] = []
    cancel_active_run(ctx)
    restore_policies(ctx)
    assign_team(ctx, [])
    if ctx.keep_agents:
        return cleanup_results
    for name in list(ctx.created_agents):
        cleanup_results.append({"name": name, **delete_profile(ctx, name)})
    return cleanup_results


def write_reports(ctx: Context, cleanup_results: list[dict[str, Any]]) -> tuple[Path, Path]:
    REPORT_DIR.mkdir(exist_ok=True)
    basename = f"demo_booth_validation_{ctx.stamp}"
    json_path = REPORT_DIR / f"{basename}.json"
    md_path = REPORT_DIR / f"{basename}.md"
    pass_count = sum(1 for s in ctx.scenarios if s.status == "pass")
    warn_count = sum(1 for s in ctx.scenarios if s.status == "warn")
    fail_count = sum(1 for s in ctx.scenarios if s.status == "fail")
    payload = {
        "ok": fail_count == 0,
        "base": ctx.base,
        "sandbox": ctx.sandbox,
        "stamp": ctx.stamp,
        "duration_seconds": round(time.monotonic() - ctx.started_at, 2),
        "summary": {"pass": pass_count, "warn": warn_count, "fail": fail_count, "total": len(ctx.scenarios)},
        "scenarios": [
            {
                "name": s.name,
                "status": s.status,
                "duration_seconds": s.duration_seconds,
                "run_id": s.run_id,
                "notes": s.notes,
                "evidence": s.evidence,
            }
            for s in ctx.scenarios
        ],
        "cleanup": cleanup_results,
    }
    json_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    lines = [
        "# Demo Booth Validation Report",
        "",
        f"- Base: `{ctx.base}`",
        f"- Sandbox: `{ctx.sandbox}`",
        f"- Stamp: `{ctx.stamp}`",
        f"- Duration: `{payload['duration_seconds']}s`",
        f"- Summary: `{pass_count} pass / {warn_count} warn / {fail_count} fail`",
        "",
        "## Results",
        "",
        "| Scenario | Status | Runtime | Run | Notes |",
        "| --- | --- | ---: | --- | --- |",
    ]
    for s in ctx.scenarios:
        notes = "<br>".join(s.notes) if s.notes else ""
        lines.append(
            f"| {s.name} | {s.status.upper()} | {s.duration_seconds:.1f}s | "
            f"{s.run_id or ''} | {notes} |"
        )
    lines.extend([
        "",
        "## Demo Readiness Interpretation",
        "",
        "- PASS means the workflow is booth-ready on the current Spark backend.",
        "- WARN means the app surfaced the truth, but the story needs positioning or setup before a visitor can rely on it.",
        "- FAIL means a hard reliability issue that should be fixed before using that workflow live.",
        "",
        "## Operator Notes",
        "",
        "- Keep Relay Check and the static website workflow as the primary executable demo path.",
        "- Use Hermes crabs visually unless `OFFICE_AGENTS_HERMES_COMMAND` is configured.",
        "- Use OpenShell network rules to explain approve-after-deny behavior; approving a rule enables future retries, not replay.",
        "- Use the Run artifacts panel to open generated HTML/CSS artifacts after coding workflows.",
        "",
        "## Detailed Evidence",
        "",
    ])
    for s in ctx.scenarios:
        lines.extend([
            f"### {s.name}",
            "",
            f"- Status: `{s.status}`",
            f"- Run ID: `{s.run_id or ''}`",
            "",
            "```json",
            json.dumps(s.evidence, indent=2, sort_keys=True, default=str)[:6000],
            "```",
            "",
        ])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, md_path


def selected(args: argparse.Namespace, name: str) -> bool:
    raw = str(args.scenarios or "all").strip().lower()
    if raw == "all":
        return True
    return name in {part.strip() for part in raw.split(",") if part.strip()}


def run_suite(ctx: Context, args: argparse.Namespace) -> None:
    if selected(args, "readiness"):
        add_scenario(ctx, scenario_readiness(ctx))
    if selected(args, "profiles"):
        add_scenario(ctx, scenario_profiles(ctx))
    else:
        # Most scenario subsets still need profiles.
        scenario_profiles(ctx)
    if selected(args, "edges"):
        add_scenario(ctx, scenario_edge_cases(ctx))
    if selected(args, "policies"):
        add_scenario(ctx, scenario_policies(ctx))
    if selected(args, "report"):
        add_scenario(ctx, scenario_report(ctx))
    if selected(args, "coding"):
        add_scenario(ctx, scenario_coding(ctx))
    if selected(args, "skill"):
        add_scenario(ctx, scenario_skill(ctx))
    if selected(args, "denial"):
        add_scenario(ctx, scenario_denial(ctx))
    if selected(args, "web"):
        add_scenario(ctx, scenario_web_credential(ctx))
    if selected(args, "reset"):
        add_scenario(ctx, scenario_reset(ctx))


def main() -> int:
    args = parse_args()
    stamp = time.strftime("%m%d%H%M%S")
    ctx = Context(
        base=str(args.base).rstrip("/"),
        sandbox=str(args.sandbox),
        stamp=stamp,
        task_timeout_seconds=max(120, int(args.task_timeout_seconds)),
        keep_agents=bool(args.keep_agents),
        json_mode=bool(args.json),
    )
    cleanup_results: list[dict[str, Any]] = []
    exit_code = 0
    try:
        run_suite(ctx, args)
    except Exception as exc:
        add_scenario(
            ctx,
            scenario_result(
                "unexpected suite exception",
                ctx.started_at,
                "fail",
                {"error": f"{type(exc).__name__}: {exc}"},
                ["The suite crashed before completing all scenarios."],
            ),
        )
        exit_code = 1
    finally:
        try:
            cleanup_results = cleanup(ctx)
        except Exception as exc:
            add_scenario(
                ctx,
                scenario_result(
                    "cleanup and restore",
                    ctx.started_at,
                    "fail",
                    {"error": f"{type(exc).__name__}: {exc}"},
                    ["Cleanup failed; inspect temporary profiles and policy state manually."],
                ),
            )
            exit_code = 1

    json_path, md_path = write_reports(ctx, cleanup_results)
    fail_count = sum(1 for s in ctx.scenarios if s.status == "fail")
    warn_count = sum(1 for s in ctx.scenarios if s.status == "warn")
    if fail_count:
        exit_code = 1
    if ctx.json_mode:
        print(json.dumps({
            "ok": fail_count == 0,
            "warnings": warn_count,
            "failures": fail_count,
            "report_json": str(json_path),
            "report_markdown": str(md_path),
        }, indent=2, sort_keys=True))
    else:
        print(f"Reports written: {json_path} and {md_path}")
        print(f"Summary: {len(ctx.scenarios) - warn_count - fail_count} pass / {warn_count} warn / {fail_count} fail")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
