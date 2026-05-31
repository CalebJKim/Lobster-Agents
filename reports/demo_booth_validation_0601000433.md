# Demo Booth Validation Report

- Base: `http://127.0.0.1:4454`
- Sandbox: `nemoclaw-demo-e2e-0530182359`
- Stamp: `0601000433`
- Duration: `551.59s`
- Summary: `0 pass / 1 warn / 0 fail`

## Results

| Scenario | Status | Runtime | Run | Notes |
| --- | --- | ---: | --- | --- |
| coding workflow static website | WARN | 546.2s | nemoclaw-demo-e2e-0530182359-5d6b8826 | Run completed with outcome=success.<br>The run created/described files but the app did not expose a previewable HTML artifact URL. |

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
- Run ID: `nemoclaw-demo-e2e-0530182359-5d6b8826`

```json
{
  "agents": {
    "Booth Coder 0601000433": {
      "failure_kind": null,
      "partial": "Both files created. Here's the summary:\n\n**Files created** (in the working directory):\n- `index.html` \u2014 the page content (sandboxes, policies, lobster/crab team)\n- `styles.css` \u2014 dark-ocean theme with card layout\n\n**Browser-shareable URL in this UI:** No \u2014 this webchat environment doesn't expose a hosted static-site URL. The files live on the sandbox filesystem only.\n\n**Command to preview:**\n```bash\ncd /sandbox/runs/nemoclaw-demo-e2e-0530182359-5d6b8826/booth-coder-0601000433-claw\npython3 -m htt...",
      "success": true
    }
  },
  "artifacts": {
    "error": "Error:   \u00d7 status: InvalidArgument, message: \"command argument 2 contains newline or\n  \u2502 carriage return characters\", details: [], metadata: MetadataMap { headers:\n  \u2502 {\"content-type\": \"application/grpc\", \"date\": \"Sun, 31 May 2026 16:13:42\n  \u2502 GMT\", \"x-request-id\": \"d96748b0-a4b8-4e34-a82e-3f9a96789f3e\"} }",
    "files": [],
    "ok": false
  },
  "errors": {},
  "failure_kind": null,
  "outcome": "success",
  "outputs": {
    "Booth Coder 0601000433": "Both files created. Here's the summary:\n\n**Files created** (in the working directory):\n- `index.html` \u2014 the page content (sandboxes, policies, lobster/crab team)\n- `styles.css` \u2014 dark-ocean theme with card layout\n\n**Browser-shareable URL in this UI:** No \u2014 this webchat environment doesn't expose a hosted static-site URL. The files live on the sandbox filesystem only.\n\n**Command to preview:**\n```bash\ncd /sandbox/runs/nemoclaw-demo-e2e-0530182359-5d6b8826/booth-coder-0601000433-claw\npython3 -m http.server 8000\n```\nThen visit `http://localhost:8000` in a browser."
  },
  "phase": "result",
  "run_id": "nemoclaw-demo-e2e-0530182359-5d6b8826",
  "skill_status": "{\"Booth Coder 0601000433\": {\"claw_id\": \"booth-coder-0601000433-claw\", \"install_failed\": [\"coding-agent\"], \"install_succeeded\": [], \"installed\": [], \"missing\": [], \"needs_setup\": [\"coding-agent\"], \"raw\": \"Skills (7/53 ready)\\n\\u250c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2510\\n\\u2502 Status        \\u2502 Skill                    \\u2502 Description                                          \\u2502 Source             \\u2502\\n\\u251c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u253c\\...",
  "status": "finished",
  "success_count": 1,
  "timed_out": false,
  "tool_error_count": 0,
  "total_count": 1,
  "violation_count": 0
}
```
