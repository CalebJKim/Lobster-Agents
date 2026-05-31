# Demo Booth Validation Report

- Base: `http://127.0.0.1:4454`
- Sandbox: `nemoclaw-demo-e2e-0530182359`
- Stamp: `0531232111`
- Duration: `1036.65s`
- Summary: `0 pass / 0 warn / 1 fail`

## Results

| Scenario | Status | Runtime | Run | Notes |
| --- | --- | ---: | --- | --- |
| collaborative report writing | FAIL | 1031.5s | nemoclaw-demo-e2e-0530182359-29813264 | Task did not finish within 900s; cancellation requested. |

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

- Status: `fail`
- Run ID: `nemoclaw-demo-e2e-0530182359-29813264`

```json
{
  "run": "{\"agent_runs\": {}, \"agents\": [\"Booth Researcher 0531232111\", \"Booth Writer 0531232111\"], \"current_agent\": \"Booth Writer 0531232111\", \"errors\": {}, \"last_message\": \"Running Booth Writer 0531232111's OpenClaw turn in demo e2e 0530182359.\", \"last_update_at\": \"2026-05-31T08:32:24.493268\", \"mode\": \"coordinated\", \"outputs\": {}, \"partial_output\": {}, \"phase\": \"openclaw\", \"policies\": [\"brave\", \"brew\", \"huggingface\", \"local-inference\", \"npm\", \"pypi\"], \"policy_snapshot\": [\"brave\", \"brew\", \"huggingface\", \"local-inference\", \"npm\", \"pypi\"], \"run_id\": \"nemoclaw-demo-e2e-0530182359-29813264\", \"running\": true, \"sandbox_name\": \"nemoclaw-demo-e2e-0530182359\", \"skill_status\": {\"Booth Researcher 0531232111\": {\"claw_id\": \"booth-researcher-0531232111-claw\", \"install_failed\": [], \"install_succeeded\": [], \"installed\": [], \"missing\": [], \"needs_setup\": [], \"raw\": \"Skills (7/53 ready)\\n\\u250c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500..."
}
```
