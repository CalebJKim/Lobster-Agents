# Demo Booth Validation Report

- Base: `http://127.0.0.1:4454`
- Sandbox: `nemoclaw-captain-bridge`
- Stamp: `0601094904-24140`
- Duration: `172.17s`
- Summary: `1 pass / 0 warn / 0 fail`

## Results

| Scenario | Status | Runtime | Run | Notes |
| --- | --- | ---: | --- | --- |
| coding workflow static website | PASS | 165.8s | nemoclaw-captain-bridge-6de3ee11 | Run completed with outcome=success. |

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
- Run ID: `nemoclaw-captain-bridge-6de3ee11`

```json
{
  "agents": {
    "Booth Coder 0601094904-24140": {
      "failure_kind": null,
      "partial": "Both files are in place. Here's the summary:\n\n**Files created:**\n1. `index.html` \u2014 2,648 bytes\n2. `styles.css` \u2014 1,232 bytes\n\n**Preview command:**\n```\ncd /sandbox/runs/nemoclaw-captain-bridge-6de3ee11/booth-coder-0601094904-24140-claw && python3 -m http.server 8080\n```\nThen open `http://localhost:8080` in a browser.\n\n**Browser-shareable URL:** Not available in this webchat UI \u2014 there's no exposed URL for the sandbox directory. If you need one, you'd either run the local server above on a reachab...",
      "success": true
    }
  },
  "artifacts": {
    "error": null,
    "files": [
      {
        "kind": "html",
        "path": "booth-coder-0601094904-24140-claw/index.html",
        "previewable": true,
        "size": 2682,
        "url": "/sandboxes/nemoclaw-captain-bridge/tasks/nemoclaw-captain-bridge-6de3ee11/artifacts/booth-coder-0601094904-24140-claw/index.html"
      },
      {
        "kind": "text",
        "path": "booth-coder-0601094904-24140-claw/styles.css",
        "previewable": true,
        "size": 1242,
        "url": "/sandboxes/nemoclaw-captain-bridge/tasks/nemoclaw-captain-bridge-6de3ee11/artifacts/booth-coder-0601094904-24140-claw/styles.css"
      }
    ],
    "ok": true,
    "run_id": "nemoclaw-captain-bridge-6de3ee11",
    "sandbox_name": "nemoclaw-captain-bridge"
  },
  "errors": {},
  "failure_kind": null,
  "outcome": "success",
  "outputs": {
    "Booth Coder 0601094904-24140": "Both files are in place. Here's the summary:\n\n**Files created:**\n1. `index.html` \u2014 2,648 bytes\n2. `styles.css` \u2014 1,232 bytes\n\n**Preview command:**\n```\ncd /sandbox/runs/nemoclaw-captain-bridge-6de3ee11/booth-coder-0601094904-24140-claw && python3 -m http.server 8080\n```\nThen open `http://localhost:8080` in a browser.\n\n**Browser-shareable URL:** Not available in this webchat UI \u2014 there's no exposed URL for the sandbox directory. If you need one, you'd either run the local server above on a reachable host, or use a tunnel service."
  },
  "phase": "result",
  "run_id": "nemoclaw-captain-bridge-6de3ee11",
  "skill_status": "{\"Booth Coder 0601094904-24140\": {\"claw_id\": \"booth-coder-0601094904-24140-claw\", \"install_failed\": [], \"install_succeeded\": [], \"installed\": [], \"missing\": [], \"needs_setup\": [], \"raw\": \"Skills (8/53 ready)\\n\\u250c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u252c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2510\\n\\u2502 Status        \\u2502 Skill                    \\u2502 Description                                          \\u2502 Source             \\u2502\\n\\u251c\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u253c\\u2500\\u2500\\u250...",
  "status": "finished",
  "success_count": 1,
  "timed_out": false,
  "tool_error_count": 0,
  "total_count": 1,
  "violation_count": 0
}
```
