# Demo Booth Validation Report

- Base: `http://127.0.0.1:4454`
- Sandbox: `nemoclaw-demo-e2e-0530182359`
- Stamp: `0531234424`
- Duration: `638.09s`
- Summary: `1 pass / 0 warn / 0 fail`

## Results

| Scenario | Status | Runtime | Run | Notes |
| --- | --- | ---: | --- | --- |
| collaborative report writing | PASS | 633.2s | nemoclaw-demo-e2e-0530182359-b1419c58 | Run completed with outcome=success. |

## Demo Readiness Interpretation

- PASS means the workflow is booth-ready on the current Spark backend.
- WARN means the app surfaced the truth, but the story needs positioning or setup before a visitor can rely on it.
- FAIL means a hard reliability issue that should be fixed before using that workflow live.

## Operator Notes

- Keep the Relay Check and report-writing workflows as the primary executable demo path.
- Use Hermes crabs visually unless `OFFICE_AGENTS_HERMES_COMMAND` is configured.
- Use OpenShell network rules to explain approve-after-deny behavior; approving a rule enables future retries, not replay.
- Do not promise a shareable website URL unless artifact hosting is implemented or the agent reports a working preview command.

## Detailed Evidence

### collaborative report writing

- Status: `pass`
- Run ID: `nemoclaw-demo-e2e-0530182359-b1419c58`

```json
{
  "agents": {
    "Booth Researcher 0531234424": {
      "failure_kind": null,
      "partial": "**Researcher:** Sandboxed agent teams enable safe experimentation without risking production systems and allow isolated, parallel scaling of workloads.\n\n**Writer \u2014 Booth Demo Mini Report**\n\n**Sandboxed Agent Teams: Demo Overview**\n\n- Isolated execution: each agent runs in its own sandbox, preventing cross-contamination.\n- Safe iteration: researchers test freely, knowing failures stay contained.\n- Parallel throughput: multiple agents work simultaneously without resource contention.\n- *Risk:* Over...",
      "success": true
    },
    "Booth Writer 0531234424": {
      "failure_kind": null,
      "partial": "**Sandboxed Agent Teams: Demo Report**\n\n- Isolated execution ensures each agent operates in its own sandbox, eliminating cross-contamination risks.\n- Safe iteration empowers researchers to experiment freely, knowing failures remain fully contained.\n- Parallel throughput lets multiple agents run simultaneously without resource contention.\n\n*Risk:* Over-provisioned sandboxes can strain host resources. *Mitigation:* enforce per-agent resource quotas and auto-scaling limits.",
      "success": true
    }
  },
  "errors": {},
  "failure_kind": null,
  "outcome": "success",
  "outputs": {
    "Booth Researcher 0531234424": "**Researcher:** Sandboxed agent teams enable safe experimentation without risking production systems and allow isolated, parallel scaling of workloads.\n\n**Writer \u2014 Booth Demo Mini Report**\n\n**Sandboxed Agent Teams: Demo Overview**\n\n- Isolated execution: each agent runs in its own sandbox, preventing cross-contamination.\n- Safe iteration: researchers test freely, knowing failures stay contained.\n- Parallel throughput: multiple agents work simultaneously without resource contention.\n- *Risk:* Over-provisioned sandboxes strain host resources. *Mitigation:* enforce per-agent resource quotas and auto-scaling limits.",
    "Booth Writer 0531234424": "**Sandboxed Agent Teams: Demo Report**\n\n- Isolated execution ensures each agent operates in its own sandbox, eliminating cross-contamination risks.\n- Safe iteration empowers researchers to experiment freely, knowing failures remain fully contained.\n- Parallel throughput lets multiple agents run simultaneously without resource contention.\n\n*Risk:* Over-provisioned sandboxes can strain host resources. *Mitigation:* enforce per-agent resource quotas and auto-scaling limits."
  },
  "phase": "result",
  "run_id": "nemoclaw-demo-e2e-0530182359-b1419c58",
  "skill_status": "{\"Booth Researcher 0531234424\": {\"claw_id\": \"booth-researcher-0531234424-claw\", \"install_failed\": [], \"install_succeeded\": [], \"installed\": [], \"missing\": [], \"needs_setup\": [], \"raw\": \"Skills (7/53 ready)\\n\\u250c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2510\\n\\u2502 Status        \\u2502 Skill                    \\u2502 Description                                          \\u2502 Source             \\u2502\\n\\u251c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u253c\\u2500\\u2500\\u2500\\...",
  "status": "finished",
  "success_count": 2,
  "timed_out": false,
  "tool_error_count": 0,
  "total_count": 2,
  "violation_count": 0
}
```
