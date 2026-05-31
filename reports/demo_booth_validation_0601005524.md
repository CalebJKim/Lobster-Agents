# Demo Booth Validation Report

- Base: `http://127.0.0.1:4454`
- Sandbox: `nemoclaw-demo-e2e-0530182359`
- Stamp: `0601005524`
- Duration: `152.09s`
- Summary: `1 pass / 0 warn / 0 fail`

## Results

| Scenario | Status | Runtime | Run | Notes |
| --- | --- | ---: | --- | --- |
| coding workflow static website | PASS | 145.8s | nemoclaw-demo-e2e-0530182359-e1a384f8 | Run completed with outcome=success. |

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

### coding workflow static website

- Status: `pass`
- Run ID: `nemoclaw-demo-e2e-0530182359-e1a384f8`

```json
{
  "agents": {
    "Booth Coder 0601005524": {
      "failure_kind": null,
      "partial": "Both files are created. Here's the report:\n\n**Files created:**\n- `index.html` \u2014 landing page with sandboxes, policies, and the claw/scuttle/shell team cards\n- `styles.css` \u2014 dark ocean theme with orange accents\n\n**Browser-shareable URL:** Not directly available in this webchat UI \u2014 there's no built-in static server exposed for browsing. To share it, you'd need to serve it through an external host (e.g., GitHub Pages, Netlify, or a local server).\n\n**Preview command:**\n```bash\ncd /sandbox/runs/nem...",
      "success": true
    }
  },
  "artifacts": {
    "error": null,
    "files": [
      {
        "kind": "html",
        "path": "booth-coder-0601005524-claw/index.html",
        "previewable": true,
        "size": 2622,
        "url": "/sandboxes/nemoclaw-demo-e2e-0530182359/tasks/nemoclaw-demo-e2e-0530182359-e1a384f8/artifacts/booth-coder-0601005524-claw/index.html"
      },
      {
        "kind": "text",
        "path": "booth-coder-0601005524-claw/styles.css",
        "previewable": true,
        "size": 1575,
        "url": "/sandboxes/nemoclaw-demo-e2e-0530182359/tasks/nemoclaw-demo-e2e-0530182359-e1a384f8/artifacts/booth-coder-0601005524-claw/styles.css"
      }
    ],
    "ok": true,
    "run_id": "nemoclaw-demo-e2e-0530182359-e1a384f8",
    "sandbox_name": "nemoclaw-demo-e2e-0530182359"
  },
  "errors": {},
  "failure_kind": null,
  "outcome": "success",
  "outputs": {
    "Booth Coder 0601005524": "Both files are created. Here's the report:\n\n**Files created:**\n- `index.html` \u2014 landing page with sandboxes, policies, and the claw/scuttle/shell team cards\n- `styles.css` \u2014 dark ocean theme with orange accents\n\n**Browser-shareable URL:** Not directly available in this webchat UI \u2014 there's no built-in static server exposed for browsing. To share it, you'd need to serve it through an external host (e.g., GitHub Pages, Netlify, or a local server).\n\n**Preview command:**\n```bash\ncd /sandbox/runs/nemoclaw-demo-e2e-0530182359-e1a384f8/booth-coder-0601005524-claw && python3 -m http.server 8080\n```\nThen open `http://localhost:8080` in a browser."
  },
  "phase": "result",
  "run_id": "nemoclaw-demo-e2e-0530182359-e1a384f8",
  "skill_status": "{\"Booth Coder 0601005524\": {\"claw_id\": \"booth-coder-0601005524-claw\", \"install_failed\": [], \"install_succeeded\": [], \"installed\": [], \"missing\": [], \"needs_setup\": [], \"raw\": \"Skills (7/53 ready)\\n\\u250c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2510\\n\\u2502 Status        \\u2502 Skill                    \\u2502 Description                                          \\u2502 Source             \\u2502\\n\\u251c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u253c\\u2500\\u2500\\u2500\\u2500\\u250...",
  "status": "finished",
  "success_count": 1,
  "timed_out": false,
  "tool_error_count": 0,
  "total_count": 1,
  "violation_count": 0
}
```
