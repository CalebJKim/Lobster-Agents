#!/usr/bin/env python3
"""Multi-sandbox booth validation for Lobster Agents.

This focuses on the core booth claim: unique OpenClaw agent teams work inside
separate NemoClaw/OpenShell sandboxes at the same time. It creates temporary
profiles, assigns each team to a distinct live sandbox, runs tasks concurrently,
checks diagnostics/artifacts/policy rules, and cleans up.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
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
class Workflow:
    name: str
    sandbox: str
    agents: list[dict[str, Any]]
    task: str
    expected_artifacts: list[str] = field(default_factory=list)
    expected_rule_delta: bool = False
    expected_skills: list[str] = field(default_factory=list)
    timeout_seconds: int = 900


@dataclass
class Result:
    name: str
    sandbox: str
    status: Status
    duration_seconds: float
    run_id: str | None = None
    notes: list[str] = field(default_factory=list)
    evidence: dict[str, Any] = field(default_factory=dict)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run multi-sandbox Lobster Agents validation.")
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument(
        "--sandboxes",
        default="nemoclaw-clawdia-reef,nemoclaw-captain-bridge,nemoclaw-pearl-script,nemoclaw-snips-workbench",
        help="Comma-separated live sandboxes to use; first four are used.",
    )
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--keep-agents", action="store_true")
    parser.add_argument(
        "--max-workers",
        type=int,
        default=2,
        help="Maximum concurrent sandbox workflows. Spark is most reliable at 1-2; GB300/vLLM may support more.",
    )
    return parser.parse_args()


def q(value: str) -> str:
    return urllib.parse.quote(value, safe="")


def http(base: str, method: str, path: str, body: dict[str, Any] | None = None, timeout: int = 45) -> tuple[int, dict[str, Any]]:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
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


def compact(value: Any, limit: int = 1800) -> Any:
    if value in ("", None) or isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, str):
        return value[:limit].rstrip() + ("..." if len(value) > limit else "")
    text = json.dumps(value, sort_keys=True, default=str)
    if len(text) <= limit:
        return value
    return text[: limit - 3].rstrip() + "..."


def make_lobster(
    *,
    name: str,
    archetype: str,
    color: str,
    hat_kind: str,
    hat_primary: str,
    hat_accent: str,
    eyewear: str = "none",
    skills: list[str] | None = None,
    mission: str,
) -> dict[str, Any]:
    return {
        "archetype": archetype,
        "name": name,
        "species": "lobster",
        "color": color,
        "appearance": {
            "headwear": "generated",
            "eyewear": eyewear,
            "generated_headwear": {
                "kind": hat_kind,
                "label": hat_kind.replace("_", " ").title(),
                "primary": hat_primary,
                "accent": hat_accent,
                "decorations": [{"type": "band", "color": hat_accent, "count": 1}],
            },
        },
        "skills": skills or [],
        "mission": mission,
    }


def build_workflows(sandboxes: list[str], stamp: str) -> list[Workflow]:
    if len(sandboxes) < 4:
        raise SystemExit("Need at least four live sandboxes for the multi-sandbox suite.")
    return [
        Workflow(
            name="two-lobster confirmation relay",
            sandbox=sandboxes[0],
            agents=[
                make_lobster(
                    name=f"Lane A Analyst {stamp}",
                    archetype="analyst",
                    color="#38bdf8",
                    hat_kind="party_hat",
                    hat_primary="#ef4444",
                    hat_accent="#facc15",
                    eyewear="sunglasses",
                    mission="Confirm sandbox collaboration in one sentence. Do not use tools unless asked.",
                ),
                make_lobster(
                    name=f"Lane A Writer {stamp}",
                    archetype="writer",
                    color="#a78bfa",
                    hat_kind="wizard_hat",
                    hat_primary="#6d28d9",
                    hat_accent="#facc15",
                    mission="Confirm sandbox collaboration in one sentence. Do not use tools unless asked.",
                ),
            ],
            task=(
                "Each lobster reply with one sentence confirming this unique NemoClaw/OpenShell "
                "sandbox team works. Do not use web search, browser, files, or shell."
            ),
        ),
        Workflow(
            name="tiny website artifact team",
            sandbox=sandboxes[1],
            agents=[
                make_lobster(
                    name=f"Lane B Coder {stamp}",
                    archetype="coder",
                    color="#10b981",
                    hat_kind="beanie",
                    hat_primary="#0f766e",
                    hat_accent="#a7f3d0",
                    eyewear="sunglasses",
                    mission="Create small static artifacts and report exact file names.",
                ),
                make_lobster(
                    name=f"Lane B Reviewer {stamp}",
                    archetype="critic",
                    color="#f59e0b",
                    hat_kind="top_hat",
                    hat_primary="#111827",
                    hat_accent="#f59e0b",
                    mission="Check teammate output and summarize whether the artifact demo is ready.",
                ),
            ],
            task=(
                "Create a tiny static website about Lobster Agents. The first lobster should make "
                "index.html and styles.css in its working directory. The second lobster should reply "
                "with one sentence confirming the files were produced from the teammate context. "
                "Do not use web search."
            ),
            expected_artifacts=["index.html", "styles.css"],
            timeout_seconds=900,
        ),
        Workflow(
            name="OpenShell deny-first policy team",
            sandbox=sandboxes[2],
            agents=[
                make_lobster(
                    name=f"Lane C Researcher {stamp}",
                    archetype="researcher",
                    color="#06b6d4",
                    hat_kind="party_hat",
                    hat_primary="#0ea5e9",
                    hat_accent="#fde68a",
                    mission="Test sandbox network boundaries and report exact denials.",
                ),
                make_lobster(
                    name=f"Lane C Explainer {stamp}",
                    archetype="writer",
                    color="#8b5cf6",
                    hat_kind="crown",
                    hat_primary="#f59e0b",
                    hat_accent="#38bdf8",
                    mission="Explain policy behavior succinctly from teammate context.",
                ),
            ],
            task=(
                "Do not use web_search. First lobster: try a direct outbound request to "
                "https://example.com from inside the sandbox using shell/network tooling. If "
                "OpenShell denies it, report the exact denial and stop. Second lobster: explain "
                "in one sentence how this shows NemoClaw/OpenShell policy enforcement."
            ),
            expected_rule_delta=True,
            timeout_seconds=900,
        ),
        Workflow(
            name="weather skill readiness team",
            sandbox=sandboxes[3],
            agents=[
                make_lobster(
                    name=f"Lane D Weather {stamp}",
                    archetype="analyst",
                    color="#22c55e",
                    hat_kind="beanie",
                    hat_primary="#14532d",
                    hat_accent="#bbf7d0",
                    skills=["weather"],
                    mission="Report skill readiness truthfully without external lookups unless asked.",
                ),
                make_lobster(
                    name=f"Lane D Synthesizer {stamp}",
                    archetype="writer",
                    color="#ec4899",
                    hat_kind="wizard_hat",
                    hat_primary="#be185d",
                    hat_accent="#fde68a",
                    mission="Summarize teammate readiness clearly.",
                ),
            ],
            task=(
                "Do not use web search, browser, files, or shell. Report whether the weather "
                "skill was requested and whether the Status tab should show it as ready, needs setup, "
                "or install failed. Keep each lobster response under one sentence."
            ),
            expected_skills=["weather"],
            timeout_seconds=900,
        ),
    ]


def create_profiles(base: str, workflow: Workflow) -> list[str]:
    names: list[str] = []
    for payload in workflow.agents:
        code, body = http(base, "POST", "/lobsters", payload, timeout=45)
        if code != 200:
            raise RuntimeError(f"create profile {payload['name']} failed ({code}): {body}")
        names.append(str(payload["name"]))
    return names


def cleanup(base: str, workflow: Workflow, names: list[str], keep_agents: bool) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    try:
        code, body = http(base, "POST", f"/sandboxes/{q(workflow.sandbox)}/team", {"agent_names": []}, timeout=45)
        results.append({"action": "clear_team", "code": code, "body": compact(body)})
    except Exception as exc:
        results.append({"action": "clear_team", "error": f"{type(exc).__name__}: {exc}"})
    if keep_agents:
        return results
    intended = [str(payload["name"]) for payload in workflow.agents]
    for name in dict.fromkeys([*names, *intended]):
        try:
            code, body = http(base, "DELETE", f"/lobsters/{q(name)}", timeout=45)
            results.append({"action": "delete_profile", "name": name, "code": code, "body": compact(body)})
        except Exception as exc:
            results.append({"action": "delete_profile", "name": name, "error": f"{type(exc).__name__}: {exc}"})
    return results


def wait_for_run(base: str, sandbox: str, run_id: str, timeout_seconds: int) -> dict[str, Any]:
    started = time.monotonic()
    last_status: dict[str, Any] = {}
    while time.monotonic() - started < timeout_seconds:
        code, body = http(base, "GET", "/sandboxes", timeout=45)
        if code == 200:
            for item in body.get("sandboxes", []):
                if item.get("name") == sandbox:
                    last_status = item.get("run_status") or {}
                    break
        if last_status.get("run_id") == run_id and last_status.get("status") == "finished":
            return last_status
        time.sleep(5)
    http(base, "POST", f"/sandboxes/{q(sandbox)}/task/{q(run_id)}/cancel", timeout=45)
    cancel_started = time.monotonic()
    while time.monotonic() - cancel_started < 75:
        code, body = http(base, "GET", "/sandboxes", timeout=45)
        if code == 200:
            for item in body.get("sandboxes", []):
                if item.get("name") == sandbox:
                    last_status = item.get("run_status") or last_status
                    break
        if (
            last_status.get("run_id") == run_id
            and last_status.get("status") in {"finished", "cancelled", "error"}
            and not last_status.get("running")
        ):
            return {"status": "timeout_cancelled", "run_id": run_id, "last_status": last_status}
        time.sleep(5)
    return {"status": "timeout_cancel_pending", "run_id": run_id, "last_status": last_status}


def network_rule_counts(base: str, sandbox: str) -> dict[str, int]:
    code, body = http(base, "GET", f"/sandboxes/{q(sandbox)}/network-rules?status=all", timeout=60)
    if code != 200:
        return {}
    counts = body.get("counts")
    return counts if isinstance(counts, dict) else {}


def run_workflow(base: str, workflow: Workflow, keep_agents: bool) -> Result:
    started = time.monotonic()
    names: list[str] = []
    cleanup_results: list[dict[str, Any]] = []
    cleaned = False
    before_rules = network_rule_counts(base, workflow.sandbox) if workflow.expected_rule_delta else {}
    try:
        names = create_profiles(base, workflow)
        code, body = http(base, "POST", f"/sandboxes/{q(workflow.sandbox)}/team", {"agent_names": names}, timeout=45)
        if code != 200:
            return Result(workflow.name, workflow.sandbox, "fail", time.monotonic() - started, notes=[f"assign failed HTTP {code}"], evidence={"assign": body})
        code, body = http(
            base,
            "POST",
            f"/sandboxes/{q(workflow.sandbox)}/task",
            {"task": workflow.task, "agent_names": names},
            timeout=60,
        )
        if code != 200 or not body.get("run_id"):
            return Result(workflow.name, workflow.sandbox, "fail", time.monotonic() - started, notes=[f"start failed HTTP {code}"], evidence={"start": body})
        run_id = str(body["run_id"])
        final_status = wait_for_run(base, workflow.sandbox, run_id, workflow.timeout_seconds)
        code, diagnostics = http(base, "GET", f"/sandboxes/{q(workflow.sandbox)}/tasks/{q(run_id)}/diagnostics", timeout=80)
        if code != 200:
            return Result(workflow.name, workflow.sandbox, "fail", time.monotonic() - started, run_id=run_id, notes=[f"diagnostics failed HTTP {code}"], evidence={"diagnostics": diagnostics, "final_status": final_status})
        agent_runs = diagnostics.get("agent_runs") if isinstance(diagnostics.get("agent_runs"), dict) else {}
        successes = [name for name, info in agent_runs.items() if isinstance(info, dict) and info.get("success")]
        failures = [name for name, info in agent_runs.items() if not (isinstance(info, dict) and info.get("success"))]
        status: Status = "pass" if len(successes) == len(names) and not failures else "fail"
        notes = [f"{len(successes)}/{len(names)} agents succeeded."]
        evidence: dict[str, Any] = {
            "final_status": compact(final_status),
            "agents": {name: bool((agent_runs.get(name) or {}).get("success")) for name in names},
            "outputs": {name: compact((agent_runs.get(name) or {}).get("partial_output"), 500) for name in names},
            "failure_kind": diagnostics.get("failure_kind"),
            "skill_status": compact(diagnostics.get("skill_status"), 2500),
        }
        if workflow.expected_artifacts:
            code, artifacts = http(base, "GET", f"/sandboxes/{q(workflow.sandbox)}/tasks/{q(run_id)}/artifacts", timeout=80)
            files = artifacts.get("files") if code == 200 and isinstance(artifacts.get("files"), list) else []
            paths = [str(item.get("path") or "") for item in files if isinstance(item, dict)]
            missing = [name for name in workflow.expected_artifacts if not any(path.endswith(name) for path in paths)]
            evidence["artifacts"] = compact(artifacts)
            if missing:
                status = "fail"
                notes.append(f"Missing artifacts: {', '.join(missing)}")
            else:
                notes.append("Expected artifacts are visible through the artifact API.")
        if workflow.expected_skills:
            skill_text = json.dumps(diagnostics.get("skill_status") or {}, sort_keys=True).lower()
            missing_skills = [skill for skill in workflow.expected_skills if skill.lower() not in skill_text]
            failed_skills = [
                skill for skill in workflow.expected_skills
                if f'"install_failed": ["{skill.lower()}"]' in skill_text
            ]
            if missing_skills or failed_skills:
                status = "fail"
                if missing_skills:
                    notes.append(f"Missing skill readiness evidence: {', '.join(missing_skills)}")
                if failed_skills:
                    notes.append(f"Skill install failed: {', '.join(failed_skills)}")
            else:
                notes.append(f"Skill readiness evidence present: {', '.join(workflow.expected_skills)}")
        if workflow.expected_rule_delta:
            after_rules = network_rule_counts(base, workflow.sandbox)
            evidence["network_rules_before"] = before_rules
            evidence["network_rules_after"] = after_rules
            if after_rules.get("pending", 0) <= before_rules.get("pending", 0):
                output_text = json.dumps(evidence.get("outputs") or {}, sort_keys=True).lower()
                if "denied" in output_text or "403 forbidden" in output_text or "connect tunnel failed" in output_text:
                    notes.append("OpenShell denial was observed; matching pending rule already existed.")
                else:
                    status = "warn" if status == "pass" else status
                    notes.append("Run succeeded, but pending network-rule count did not increase.")
            else:
                notes.append("OpenShell pending network-rule count increased.")
        return Result(workflow.name, workflow.sandbox, status, time.monotonic() - started, run_id=run_id, notes=notes, evidence=evidence)
    except Exception as exc:
        cleanup_results = cleanup(base, workflow, names, keep_agents)
        cleaned = True
        return Result(
            workflow.name,
            workflow.sandbox,
            "fail",
            time.monotonic() - started,
            notes=[f"{type(exc).__name__}: {exc}"],
            evidence={"cleanup": compact(cleanup_results)},
        )
    finally:
        if not cleaned:
            cleanup(base, workflow, names, keep_agents)


def write_report(
    stamp: str,
    base: str,
    results: list[Result],
    started_at: float,
    *,
    max_workers: int,
) -> tuple[Path, Path]:
    REPORT_DIR.mkdir(exist_ok=True)
    payload = {
        "base": base,
        "stamp": stamp,
        "max_workers": max_workers,
        "duration_seconds": round(time.monotonic() - started_at, 2),
        "summary": {
            "pass": sum(1 for r in results if r.status == "pass"),
            "warn": sum(1 for r in results if r.status == "warn"),
            "fail": sum(1 for r in results if r.status == "fail"),
            "total": len(results),
        },
        "results": [
            {
                "name": r.name,
                "sandbox": r.sandbox,
                "status": r.status,
                "duration_seconds": round(r.duration_seconds, 2),
                "run_id": r.run_id,
                "notes": r.notes,
                "evidence": r.evidence,
            }
            for r in results
        ],
    }
    json_path = REPORT_DIR / f"demo_multisandbox_validation_{stamp}.json"
    md_path = REPORT_DIR / f"demo_multisandbox_validation_{stamp}.md"
    json_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    lines = [
        "# Multi-Sandbox Validation Report",
        "",
        f"- Base: `{base}`",
        f"- Stamp: `{stamp}`",
        f"- Max workers: `{max_workers}`",
        f"- Duration: `{payload['duration_seconds']}s`",
        f"- Summary: `{payload['summary']['pass']} pass / {payload['summary']['warn']} warn / {payload['summary']['fail']} fail`",
        "",
        "| Workflow | Sandbox | Status | Runtime | Run | Notes |",
        "| --- | --- | --- | ---: | --- | --- |",
    ]
    for r in results:
        lines.append(
            f"| {r.name} | `{r.sandbox}` | {r.status.upper()} | {r.duration_seconds:.1f}s | "
            f"{r.run_id or ''} | {'<br>'.join(r.notes)} |"
        )
    lines.extend(["", "## Evidence", ""])
    for r in results:
        lines.extend([
            f"### {r.name}",
            "",
            f"- Sandbox: `{r.sandbox}`",
            f"- Status: `{r.status}`",
            f"- Run ID: `{r.run_id or ''}`",
            "",
            "```json",
            json.dumps(r.evidence, indent=2, sort_keys=True),
            "```",
            "",
        ])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, md_path


def main() -> int:
    args = parse_args()
    started = time.monotonic()
    base = str(args.base).rstrip("/")
    stamp = f"{time.strftime('%m%d%H%M%S')}-{os.getpid()}"
    sandboxes = [item.strip() for item in str(args.sandboxes).split(",") if item.strip()]
    workflows = build_workflows(sandboxes, stamp)
    max_workers = max(1, min(int(args.max_workers), len(workflows)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(run_workflow, base, workflow, bool(args.keep_agents)) for workflow in workflows]
        results = [future.result() for future in concurrent.futures.as_completed(futures)]
    results.sort(key=lambda item: item.name)
    json_path, md_path = write_report(stamp, base, results, started, max_workers=max_workers)
    fail_count = sum(1 for result in results if result.status == "fail")
    output = {
        "ok": fail_count == 0,
        "failures": fail_count,
        "warnings": sum(1 for result in results if result.status == "warn"),
        "max_workers": max_workers,
        "report_json": str(json_path),
        "report_markdown": str(md_path),
    }
    if args.json:
        print(json.dumps(output, indent=2, sort_keys=True))
    else:
        print(f"Wrote {md_path}")
        print(json.dumps(output, indent=2, sort_keys=True))
    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
