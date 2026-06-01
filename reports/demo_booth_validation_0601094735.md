# Demo Booth Validation Report

- Base: `http://127.0.0.1:4454`
- Sandbox: `nemoclaw-demo-e2e-0530182359`
- Stamp: `0601094735`
- Duration: `6.87s`
- Summary: `0 pass / 0 warn / 1 fail`

## Results

| Scenario | Status | Runtime | Run | Notes |
| --- | --- | ---: | --- | --- |
| coding workflow static website | FAIL | 1.4s |  | Could not start task: HTTP 400 |

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

- Status: `fail`
- Run ID: ``

```json
{
  "start": {
    "detail": "No lobsters are assigned to nemoclaw-demo-e2e-0530182359."
  }
}
```
