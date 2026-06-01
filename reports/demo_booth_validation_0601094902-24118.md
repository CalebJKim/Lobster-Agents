# Demo Booth Validation Report

- Base: `http://127.0.0.1:4454`
- Sandbox: `nemoclaw-pearl-script`
- Stamp: `0601094902-24118`
- Duration: `119.24s`
- Summary: `1 pass / 0 warn / 0 fail`

## Results

| Scenario | Status | Runtime | Run | Notes |
| --- | --- | ---: | --- | --- |
| OpenShell network denial recommendation | PASS | 112.5s | nemoclaw-pearl-script-9ed83805 | Run completed with outcome=success. |

## Demo Readiness Interpretation

- PASS means the workflow is booth-ready on the current Spark backend.
- WARN means the app surfaced the truth, but the story needs positioning or setup before a visitor can rely on it.
- FAIL means a hard reliability issue that should be fixed before using that workflow live.

## Operator Notes

- Keep Relay Check and the static website workflow as the primary executable demo path.
- Use Hermes crabs visually unless `OFFICE_AGENTS_HERMES_COMMAND` is configured.
- Use OpenShell network rules to explain approve-after-deny behavior; approving a rule enables future retries, not replay.
- Use the Run artifacts panel to open generated HTML/CSS artifacts after coding workflows.

## Detailed Evidence

### OpenShell network denial recommendation

- Status: `pass`
- Run ID: `nemoclaw-pearl-script-9ed83805`

```json
{
  "agents": {
    "Booth Researcher 0601094902-24118": {
      "failure_kind": null,
      "partial": "**Denied.** The outbound request to `https://example.com` was blocked by the sandbox's network policy.\n\nExact denial:\n\n```\n* Uses proxy env variable https_proxy == 'http://10.200.0.1:3128'\n* CONNECT example.com:443 HTTP/1.1\n< HTTP/1.1 403 Forbidden\n< Content-Type: application/json\n< Content-Length: 84\ncurl: (56) CONNECT tunnel failed, response 403\n```\n\nThe sandbox routes outbound traffic through an HTTP proxy at `10.200.0.1:3128`. The proxy returned a **403 Forbidden** on the CONNECT tunnel to `...",
      "success": true
    }
  },
  "errors": {},
  "failure_kind": null,
  "network_rules_after": {
    "approved": 0,
    "pending": 3,
    "rejected": 0
  },
  "network_rules_before": {
    "approved": 0,
    "pending": 2,
    "rejected": 0
  },
  "outcome": "success",
  "outputs": {
    "Booth Researcher 0601094902-24118": "**Denied.** The outbound request to `https://example.com` was blocked by the sandbox's network policy.\n\nExact denial:\n\n```\n* Uses proxy env variable https_proxy == 'http://10.200.0.1:3128'\n* CONNECT example.com:443 HTTP/1.1\n< HTTP/1.1 403 Forbidden\n< Content-Type: application/json\n< Content-Length: 84\ncurl: (56) CONNECT tunnel failed, response 403\n```\n\nThe sandbox routes outbound traffic through an HTTP proxy at `10.200.0.1:3128`. The proxy returned a **403 Forbidden** on the CONNECT tunnel to `example.com:443`, confirming that the sandbox's outbound firewall/proxy deny-list blocked the request. No data was transferred."
  },
  "phase": "result",
  "run_id": "nemoclaw-pearl-script-9ed83805",
  "skill_status": "{\"Booth Researcher 0601094902-24118\": {\"claw_id\": \"booth-researcher-0601094902-24118-claw\", \"install_failed\": [], \"install_succeeded\": [], \"installed\": [], \"missing\": [], \"needs_setup\": [], \"raw\": \"Skills (7/53 ready)\\n\\u250c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2510\\n\\u2502 Status        \\u2502 Skill                    \\u2502 Description                                          \\u2502 Source             \\u2502\\n\\u251c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u253c\\u2500\\...",
  "status": "finished",
  "success_count": 1,
  "timed_out": false,
  "tool_error_count": 0,
  "total_count": 1,
  "violation_count": 0
}
```
