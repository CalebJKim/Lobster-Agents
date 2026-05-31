# Demo Booth Validation Report

- Base: `http://127.0.0.1:4454`
- Sandbox: `nemoclaw-demo-e2e-0530182359`
- Stamp: `0601003902`
- Duration: `175.6s`
- Summary: `1 pass / 0 warn / 0 fail`

## Results

| Scenario | Status | Runtime | Run | Notes |
| --- | --- | ---: | --- | --- |
| OpenShell network denial recommendation | PASS | 169.2s | nemoclaw-demo-e2e-0530182359-4553d4bf | Run completed with outcome=success. |

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

### OpenShell network denial recommendation

- Status: `pass`
- Run ID: `nemoclaw-demo-e2e-0530182359-4553d4bf`

```json
{
  "agents": {
    "Booth Researcher 0601003902": {
      "failure_kind": null,
      "partial": "The outbound request was **denied**. Here is the exact denial:\n\n```\nCONNECT example.com:443 HTTP/1.1\nHost: example.com:443\n\nHTTP/1.1 403 Forbidden\nContent-Type: application/json\nContent-Length: 84\n```\n\nThe sandbox routes outbound HTTPS through an HTTP proxy at `10.200.0.1:3128`. The proxy's CONNECT tunnel to `example.com:443` returned **403 Forbidden**. This is consistent with a controlled sandbox environment that blocks direct outbound internet access.\n\nThe `curl` exit code was **56** (CONNECT...",
      "success": true
    }
  },
  "errors": {},
  "failure_kind": null,
  "network_rules_after": {
    "approved": 0,
    "pending": 4,
    "rejected": 0
  },
  "network_rules_before": {
    "approved": 0,
    "pending": 3,
    "rejected": 0
  },
  "outcome": "success",
  "outputs": {
    "Booth Researcher 0601003902": "The outbound request was **denied**. Here is the exact denial:\n\n```\nCONNECT example.com:443 HTTP/1.1\nHost: example.com:443\n\nHTTP/1.1 403 Forbidden\nContent-Type: application/json\nContent-Length: 84\n```\n\nThe sandbox routes outbound HTTPS through an HTTP proxy at `10.200.0.1:3128`. The proxy's CONNECT tunnel to `example.com:443` returned **403 Forbidden**. This is consistent with a controlled sandbox environment that blocks direct outbound internet access.\n\nThe `curl` exit code was **56** (CONNECT tunnel failed), confirming the connection was refused by the proxy before any data could be exchanged with the target server."
  },
  "phase": "result",
  "run_id": "nemoclaw-demo-e2e-0530182359-4553d4bf",
  "skill_status": "{\"Booth Researcher 0601003902\": {\"claw_id\": \"booth-researcher-0601003902-claw\", \"install_failed\": [], \"install_succeeded\": [], \"installed\": [], \"missing\": [], \"needs_setup\": [], \"raw\": \"Skills (7/53 ready)\\n\\u250c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2510\\n\\u2502 Status        \\u2502 Skill                    \\u2502 Description                                          \\u2502 Source             \\u2502\\n\\u251c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u253c\\u2500\\u2500\\u2500\\...",
  "status": "finished",
  "success_count": 1,
  "timed_out": false,
  "tool_error_count": 0,
  "total_count": 1,
  "violation_count": 0
}
```
