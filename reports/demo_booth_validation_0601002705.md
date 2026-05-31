# Demo Booth Validation Report

- Base: `http://127.0.0.1:4454`
- Sandbox: `nemoclaw-demo-e2e-0530182359`
- Stamp: `0601002705`
- Duration: `659.98s`
- Summary: `0 pass / 0 warn / 1 fail`

## Results

| Scenario | Status | Runtime | Run | Notes |
| --- | --- | ---: | --- | --- |
| coding-agent skill readiness | FAIL | 654.1s | nemoclaw-demo-e2e-0530182359-9e9c25ad | Expected success, got failed.<br>coding-agent is discoverable/requested but not a polished out-of-box execution demo yet. |

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

### coding-agent skill readiness

- Status: `fail`
- Run ID: `nemoclaw-demo-e2e-0530182359-9e9c25ad`

```json
{
  "agents": {
    "Booth Skill Coder 0601002705": {
      "failure_kind": "exec_failed",
      "partial": null,
      "success": false
    }
  },
  "errors": {
    "Booth Skill Coder 0601002705": "(node:8175) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time.\n(Use `node --trace-warnings ...` to show where the warning was created)\n(node:8194) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time.\n(Use `node --trace-warnings ...` to show where the warning was created)\n[plugins] plugins.allow is empty; discovered non-bundled plugins may auto-load: openclaw-weixin (/sandbox/.openclaw/extensions/openclaw-weixin/dist/index.js). Set plugins.allow to explicit trusted ids."
  },
  "failure_kind": "exec_failed",
  "outcome": "failed",
  "outputs": {},
  "phase": "result",
  "run_id": "nemoclaw-demo-e2e-0530182359-9e9c25ad",
  "skill_status": "{\"Booth Skill Coder 0601002705\": {\"claw_id\": \"booth-skill-coder-0601002705-claw\", \"install_failed\": [\"coding-agent\"], \"install_succeeded\": [], \"installed\": [], \"missing\": [], \"needs_setup\": [\"coding-agent\"], \"raw\": \"Skills (7/53 ready)\\n\\u250c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2510\\n\\u2502 Status        \\u2502 Skill                    \\u2502 Description                                          \\u2502 Source             \\u2502\\n\\u251c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\...",
  "status": "finished",
  "success_count": 0,
  "timed_out": false,
  "tool_error_count": 0,
  "total_count": 1,
  "violation_count": 0
}
```
