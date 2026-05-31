# Demo Booth Readiness Report - 2026-06-01

Validated through the local frontend proxy at `http://localhost:4454`, backed
by the Spark fallback stack at `10.110.23.141`.

## Verdict

The booth path is ready for a controlled live demo where visitors create
lobsters, customize accessories, assign teams to live NemoClaw/OpenShell
sandboxes, toggle policies, inspect OpenShell network approvals, and run
bounded OpenClaw tasks.

It is not ready for arbitrary unbounded tasks with guaranteed success. The app
now surfaces known limits clearly instead of hiding them.

## Current Live Readiness

- Backend API: OK
- Model endpoint: OK, `qwen3.6:35b-a3b`
- OpenShell CLI: OK
- NemoClaw CLI: OK
- Live sandboxes: OK, 11 detected
- OpenShell gateway: OK
- NemoClaw inference route: OK, `compatible-endpoint / qwen3.6:35b-a3b`
- Policy command: OK, 13 presets available
- Sandbox to `inference.local`: OK, 1 model entry reachable
- OpenShell network rules: WARN, 4 pending recommendations
- Credentials: WARN, `BRAVE_API_KEY` missing
- Hermes crab runtime: WARN, command not configured

Summary: `9 ok / 3 warn / 0 fail`.

## Tests Run

| Test | Result | Evidence |
| --- | --- | --- |
| Demo readiness endpoint | PASS | `9 ok / 3 warn / 0 fail`; no blockers. |
| Backend health endpoint | PASS | Model, OpenShell, NemoClaw, and 11 sandboxes reachable. |
| Booth smoke suite | PASS | `reports/demo_booth_validation_0601010455.md`: `6 pass / 0 warn / 0 fail`. |
| Full executable E2E relay | PASS | `scripts/demo_e2e.py --sandbox nemoclaw-demo-e2e-0530182359 --json`: `34/34` checks passed in `461.99s`; run `nemoclaw-demo-e2e-0530182359-7aba42ba`. |

## Full E2E Coverage

The full relay test verified:

- frontend proxy and backend health
- OpenShell/NemoClaw/model availability
- live sandbox discovery
- accessorized lobster creation and metadata persistence
- generated wizard-hat lobster profile persistence
- Hermes crab profile creation and metadata persistence
- visual lobster+crab sandbox assignment
- two-OpenClaw-lobster executable team assignment
- NemoClaw policy dry-run
- NemoClaw policy apply
- policy state reflection
- OpenShell network rule endpoint loading
- OpenClaw task start
- coordinated relay completion
- diagnostics endpoint
- both per-agent outputs preserved
- policy restore
- temporary profile cleanup

## Booth-Ready Workflows

- Build custom lobsters with color, headwear, eyewear, generated/preset accessories.
- Build crabs as Hermes-profile visuals and assign them to sandboxes.
- Create/select live NemoClaw sandboxes.
- Drag lobster/crab teams into sandboxes.
- Run short OpenClaw relay tasks with lobster agents.
- Show Task Monitor timeline, diagnostics, partial outputs, tool errors, and copyable run summaries.
- Toggle NemoClaw policy presets with dry-run/apply/restore.
- Show OpenShell network-rule recommendations and approve/reject/revoke controls.
- Run static website generation demos and open generated artifacts from the Status tab.
- Use Demo Ready to explain system health before a visitor starts.

## Important Guardrails

- Keep visitor tasks bounded. Good prompts are short relay checks, tiny reports,
  toy website generation, policy-denial demos, or local/no-web analysis.
- Avoid promising arbitrary deep research until `BRAVE_API_KEY` is configured.
- Do not present Hermes crabs as executable until `OFFICE_AGENTS_HERMES_COMMAND`
  is configured on the backend host.
- Do not present `coding-agent` marketplace skill execution as ready; the UI can
  show it as requested/discoverable, but live readiness currently reports setup
  issues.
- Long multi-agent report tasks can work but are too slow for a 5-minute booth
  slot unless constrained.

## Operator Recommendation

Use this live sequence:

1. Open `http://localhost:4454`.
2. Click **Demo Ready** and confirm zero blockers.
3. Build an accessorized lobster.
4. Build a Hermes crab and explicitly call out the runtime badge.
5. Assign them to a live sandbox.
6. Run the short two-lobster Relay Check.
7. Open Run + Outputs and show both per-agent completions.
8. Open Policies and show NemoClaw presets plus OpenShell network rules.
9. Optionally run the static website demo and open Run artifacts.

That flow is ready. Arbitrary visitor exploration is acceptable if the operator
keeps the guardrails visible and uses Demo Ready/diagnostics as the source of
truth.
