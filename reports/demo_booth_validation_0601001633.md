# Demo Booth Validation Report

- Base: `http://127.0.0.1:4454`
- Sandbox: `nemoclaw-demo-e2e-0530182359`
- Stamp: `0601001633`
- Duration: `147.16s`
- Summary: `0 pass / 1 warn / 0 fail`

## Results

| Scenario | Status | Runtime | Run | Notes |
| --- | --- | ---: | --- | --- |
| coding workflow static website | WARN | 141.2s | nemoclaw-demo-e2e-0530182359-64424a75 | Run completed with outcome=success.<br>The run created/described files but the app did not expose a previewable HTML artifact URL. |

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

### coding workflow static website

- Status: `warn`
- Run ID: `nemoclaw-demo-e2e-0530182359-64424a75`

```json
{
  "agents": {
    "Booth Coder 0601001633": {
      "failure_kind": null,
      "partial": "Let me verify both files landed correctly:",
      "success": true
    }
  },
  "artifacts": {
    "body": {
      "raw": "Internal Server Error"
    },
    "code": 500
  },
  "errors": {},
  "failure_kind": null,
  "outcome": "success",
  "outputs": {
    "Booth Coder 0601001633": "Let me verify both files landed correctly:\nDone. Here's the rundown:\n\n### Files created\n\n| File | Size | Path |\n|---|---|---|\n| `index.html` | 2,071 B | `./index.html` |\n| `styles.css` | 1,522 B | `./styles.css` |\n\n### Content summary\n\nThe site is a single-page static website with an ocean-themed design covering:\n- **What Are Sandboxes** \u2014 tide-pool analogy for isolated agent environments\n- **Lobsters & Crabs** \u2014 the team roles (builders vs. testers/auditors)\n- **Policies & Guardrails** \u2014 isolation, time-boxing, read-only defaults, auto-cleanup\n- **Get Started** \u2014 a live `python3 -m http.server 8080` code snippet\n\n### Browser-shareable URL\n\nNot available in this UI. This session is webcha..."
  },
  "phase": "result",
  "run_id": "nemoclaw-demo-e2e-0530182359-64424a75",
  "skill_status": "{\"Booth Coder 0601001633\": {\"claw_id\": \"booth-coder-0601001633-claw\", \"install_failed\": [], \"install_succeeded\": [], \"installed\": [], \"missing\": [], \"needs_setup\": [], \"raw\": \"Skills (7/53 ready)\\n\\u250c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2510\\n\\u2502 Status        \\u2502 Skill                    \\u2502 Description                                          \\u2502 Source             \\u2502\\n\\u251c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u253c\\u2500\\u2500\\u2500\\u2500\\u250...",
  "status": "finished",
  "success_count": 1,
  "timed_out": false,
  "tool_error_count": 0,
  "total_count": 1,
  "violation_count": 0
}
```
