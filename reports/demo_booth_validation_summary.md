# Demo Booth Validation Summary

Validated against the Spark demo stack through the local frontend proxy at `http://localhost:4454`.

## Current Readiness

- Backend, frontend proxy, OpenShell, NemoClaw, model endpoint, live sandboxes, gateway health, policy listing, and sandbox-to-`inference.local` are all healthy.
- Current readiness result: `9 ok / 3 warn / 0 fail`.
- Expected warnings:
  - `BRAVE_API_KEY` is missing, so external web/deep-research demos should be blocked or avoided until configured.
  - 4 OpenShell network-rule recommendations are pending, which is useful for showing approve-after-deny policy behavior.
  - Hermes runtime is not configured, so crab agents are visual/build/assign only for now.

## Passing Workflows

| Workflow | Result | Evidence |
| --- | --- | --- |
| Full executable relay | PASS | `scripts/demo_e2e.py --sandbox nemoclaw-demo-e2e-0530182359 --json` passed `34/34` in `238.39s`, run `nemoclaw-demo-e2e-0530182359-1d42bbed`. |
| Fast booth smoke suite | PASS | `reports/demo_booth_validation_0601004701.md`: `6 pass / 0 warn / 0 fail`. |
| Static website generation | PASS | `reports/demo_booth_validation_0601005524.md`: run `nemoclaw-demo-e2e-0530182359-e1a384f8`, generated previewable `index.html` and `styles.css` artifacts in `145.8s`; artifact URLs still opened after backend restart. |
| OpenShell network denial | PASS | `reports/demo_booth_validation_0601003902.md`: run `nemoclaw-demo-e2e-0530182359-4553d4bf`, sandbox denied `example.com:443` and pending rules increased from 3 to 4. |
| Report writing | PASS, slow | `reports/demo_booth_validation_0531234424.md`: run `nemoclaw-demo-e2e-0530182359-b1419c58`, both agents completed, but runtime was about `638s`. Use only if booth timing allows. |
| Profile/accessory/crab builder | PASS | Fast suite and core E2E both created accessorized lobsters plus a Hermes crab and verified persisted species/runtime/color/headwear/eyewear metadata. |
| Policy dry-run/apply/restore | PASS | Core E2E toggled `brave`; fast suite toggled `npm`; both restored original policy state. |
| Reset/clear behavior | PASS | Fast suite confirmed app clear/reset does not erase OpenShell network-rule state and profiles can be reassigned afterward. |
| Run-safety guards | PASS | Fast suite confirmed empty task, empty team, unknown profile, and unassigned requested agent are rejected before a run starts. |
| Web/deep-research guard | PASS | Fast suite confirmed missing `BRAVE_API_KEY` is surfaced as a preflight/demo readiness issue instead of letting a visitor wait on a doomed web-search run. |

## Not Booth-Ready Yet

- `coding-agent` marketplace skill execution is not ready out of the box on this stack.
  - Evidence: `reports/demo_booth_validation_0601002705.md`, run `nemoclaw-demo-e2e-0530182359-9e9c25ad`.
  - The UI can truthfully show `coding-agent` as requested/discoverable, but live readiness reports `needs_setup` and `install_failed`.
- Hermes crab execution is not configured.
  - Crabs are useful visually and can be assigned to sandboxes, but the app should continue warning that Hermes execution needs `OFFICE_AGENTS_HERMES_COMMAND`.
- Deep research with live web search needs `BRAVE_API_KEY`.
  - The guard is working, but the booth should not present external search as available until that key is configured in the sandbox environment.
- Multi-agent report writing is reliable but too slow for a 5-minute booth slot unless the prompt is very constrained or a single-agent version is used.

## Fixes Landed During This Pass

- Preserved per-agent relay output immediately after each agent finishes, so a later timeout does not erase earlier successful output.
- Added a web/deep-research preflight blocker when `BRAVE_API_KEY` is missing, while respecting prompts that explicitly say not to use web search.
- Added generated artifact listing/preview endpoints for task outputs, plus frontend Run artifacts cards.
- Fixed artifact collection inside OpenShell by base64-encoding helper scripts before passing them through `openshell sandbox exec`.
- Fixed a readiness regression in the sandbox inference probe.
- Added `scripts/demo_booth_suite.py` for repeatable booth workflow validation and Markdown/JSON reports.
- Tightened OpenClaw task prompting for simple writing/reporting tasks so agents answer directly unless the task actually asks for tools/files/browser work.

## Demo Recommendation

For a 5-minute booth loop, use this sequence:

1. Build an accessorized lobster and a Hermes crab, then assign them to a live sandbox.
2. Run the short relay check with two OpenClaw lobsters.
3. Show the Task Monitor diagnostics and preserved per-agent outputs.
4. Run or show the static website workflow and open generated HTML from Run artifacts.
5. Show OpenShell deny-first policy behavior with the pending network-rule queue.
6. Use Demo Readiness to explain missing Brave/Hermes setup honestly instead of hiding it.

Do not use `coding-agent`, live web search, or long report generation as the primary booth path until their warnings are cleared.
