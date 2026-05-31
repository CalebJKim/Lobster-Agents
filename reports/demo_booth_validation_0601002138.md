# Demo Booth Validation Report

- Base: `http://127.0.0.1:4454`
- Sandbox: `nemoclaw-demo-e2e-0530182359`
- Stamp: `0601002138`
- Duration: `299.7s`
- Summary: `1 pass / 0 warn / 0 fail`

## Results

| Scenario | Status | Runtime | Run | Notes |
| --- | --- | ---: | --- | --- |
| coding workflow static website | PASS | 292.8s | nemoclaw-demo-e2e-0530182359-94815e12 | Run completed with outcome=success. |

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
- Run ID: `nemoclaw-demo-e2e-0530182359-94815e12`

```json
{
  "agents": {
    "Booth Coder 0601002138": {
      "failure_kind": null,
      "partial": "Done. Here's the summary:\n\n**Files created** (in the working directory):\n\n| File | Size |\n|---|---|\n| `index.html` | 2,560 bytes |\n| `styles.css` | 2,660 bytes |\n\n**Browser-shareable URL:** Not available in this UI. This session uses webchat without a canvas or file-server endpoint, so there's no auto-generated URL you can paste into a browser. To view it externally you'd need to either copy the files to a host with a serving endpoint or run a local server.\n\n**Preview command** (run from the wor...",
      "success": true
    }
  },
  "artifacts": {
    "error": null,
    "files": [
      {
        "kind": "html",
        "path": "booth-coder-0601002138-claw/index.html",
        "previewable": true,
        "size": 2560,
        "url": "/sandboxes/nemoclaw-demo-e2e-0530182359/tasks/nemoclaw-demo-e2e-0530182359-94815e12/artifacts/booth-coder-0601002138-claw/index.html"
      },
      {
        "kind": "text",
        "path": "booth-coder-0601002138-claw/styles.css",
        "previewable": true,
        "size": 2660,
        "url": "/sandboxes/nemoclaw-demo-e2e-0530182359/tasks/nemoclaw-demo-e2e-0530182359-94815e12/artifacts/booth-coder-0601002138-claw/styles.css"
      }
    ],
    "ok": true,
    "run_id": "nemoclaw-demo-e2e-0530182359-94815e12",
    "sandbox_name": "nemoclaw-demo-e2e-0530182359"
  },
  "errors": {},
  "failure_kind": null,
  "outcome": "success",
  "outputs": {
    "Booth Coder 0601002138": "Done. Here's the summary:\n\n**Files created** (in the working directory):\n\n| File | Size |\n|---|---|\n| `index.html` | 2,560 bytes |\n| `styles.css` | 2,660 bytes |\n\n**Browser-shareable URL:** Not available in this UI. This session uses webchat without a canvas or file-server endpoint, so there's no auto-generated URL you can paste into a browser. To view it externally you'd need to either copy the files to a host with a serving endpoint or run a local server.\n\n**Preview command** (run from the working directory):\n\n```\npython3 -m http.server 8080\n```\n\nThen open `http://localhost:8080` in a browser. Alternatively, `npx serve .` works if Node is available.\n\nThe site features a dark ocean theme..."
  },
  "phase": "result",
  "run_id": "nemoclaw-demo-e2e-0530182359-94815e12",
  "skill_status": "{\"Booth Coder 0601002138\": {\"claw_id\": \"booth-coder-0601002138-claw\", \"install_failed\": [], \"install_succeeded\": [], \"installed\": [], \"missing\": [], \"needs_setup\": [], \"raw\": \"Skills (7/53 ready)\\n\\u250c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2510\\n\\u2502 Status        \\u2502 Skill                    \\u2502 Description                                          \\u2502 Source             \\u2502\\n\\u251c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u253c\\u2500\\u2500\\u2500\\u2500\\u250...",
  "status": "finished",
  "success_count": 1,
  "timed_out": false,
  "tool_error_count": 0,
  "total_count": 1,
  "violation_count": 0
}
```
