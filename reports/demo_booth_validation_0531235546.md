# Demo Booth Validation Report

- Base: `http://127.0.0.1:4454`
- Sandbox: `nemoclaw-demo-e2e-0530182359`
- Stamp: `0531235546`
- Duration: `134.16s`
- Summary: `1 pass / 0 warn / 0 fail`

## Results

| Scenario | Status | Runtime | Run | Notes |
| --- | --- | ---: | --- | --- |
| coding workflow static website | PASS | 129.1s | nemoclaw-demo-e2e-0530182359-7230120e | Run completed with outcome=success. |

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

- Status: `pass`
- Run ID: `nemoclaw-demo-e2e-0530182359-7230120e`

```json
{
  "agents": {
    "Booth Coder 0531235546": {
      "failure_kind": null,
      "partial": "Done. Here are the files:\n\n| File | Path |\n|---|---|\n| `index.html` | `booth-coder-0531235546-claw/index.html` (2.2 KB) |\n| `styles.css` | `booth-coder-0531235546-claw/styles.css` (1.7 KB) |\n\n**Browser-shareable URL:** No. This sandbox environment doesn't expose a public or even local browser-shareable URL. To view it you'd need to serve the files from the host or pull them out of the sandbox.\n\n**Preview command** (from this working directory):\n\n```bash\ncd /sandbox/runs/nemoclaw-demo-e2e-0530182...",
      "success": true
    }
  },
  "errors": {},
  "failure_kind": null,
  "outcome": "success",
  "outputs": {
    "Booth Coder 0531235546": "Done. Here are the files:\n\n| File | Path |\n|---|---|\n| `index.html` | `booth-coder-0531235546-claw/index.html` (2.2 KB) |\n| `styles.css` | `booth-coder-0531235546-claw/styles.css` (1.7 KB) |\n\n**Browser-shareable URL:** No. This sandbox environment doesn't expose a public or even local browser-shareable URL. To view it you'd need to serve the files from the host or pull them out of the sandbox.\n\n**Preview command** (from this working directory):\n\n```bash\ncd /sandbox/runs/nemoclaw-demo-e2e-0530182359-7230120e/booth-coder-0531235546-claw && python3 -m http.server 8080\n```\n\nThen open `http://localhost:8080` in a browser.\n\nThe page is a dark-ocean theme with lobster-coral accents \u2014 explains sa..."
  },
  "phase": "result",
  "run_id": "nemoclaw-demo-e2e-0530182359-7230120e",
  "skill_status": "{\"Booth Coder 0531235546\": {\"claw_id\": \"booth-coder-0531235546-claw\", \"install_failed\": [\"coding-agent\"], \"install_succeeded\": [], \"installed\": [], \"missing\": [], \"needs_setup\": [\"coding-agent\"], \"raw\": \"Skills (7/53 ready)\\n\\u250c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2510\\n\\u2502 Status        \\u2502 Skill                    \\u2502 Description                                          \\u2502 Source             \\u2502\\n\\u251c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u253c\\...",
  "status": "finished",
  "success_count": 1,
  "timed_out": false,
  "tool_error_count": 0,
  "total_count": 1,
  "violation_count": 0
}
```
