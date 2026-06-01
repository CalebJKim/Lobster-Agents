# Multi-Sandbox Booth Validation Summary

Date: 2026-06-01

## Purpose

Validate the booth claim that distinct OpenClaw lobster teams can be created,
assigned to separate NemoClaw/OpenShell sandboxes, run real tasks, show policy
behavior, expose skill readiness, and clean up without leaving temporary agents
behind.

## Current Host

- Backend host tested: Spark fallback
- Frontend path tested: `http://127.0.0.1:4454`
- Model route reported by readiness: `qwen3.6:35b-a3b`
- Live sandboxes reported by readiness: 11
- Recommended Spark concurrency: `OFFICE_AGENTS_SANDBOX_MAX_CONCURRENT_OPENCLAW_RUNS=1`
- GB300/vLLM note: increase the concurrency setting and suite `--max-workers`
  together after the station is reachable, because vLLM should batch better and
  the GB300 has materially more VRAM/throughput.

## Final Passing Run

Report files:

- `reports/demo_multisandbox_validation_0601113307-42757.md`
- `reports/demo_multisandbox_validation_0601113307-42757.json`

Command:

```bash
python3 scripts/demo_multisandbox_suite.py --max-workers 2 --json
```

Result:

- Summary: 4 pass / 0 warn / 0 fail
- Duration: 850.09 seconds
- Backend readiness after run: 9 OK / 3 WARN / 0 FAIL
- Temporary `Lane ...` test profiles after run: none found
- Backend crash scan after run: no traceback, crash, or backend exception found

Validated workflows:

| Workflow | Sandbox | Result | Evidence |
| --- | --- | --- | --- |
| Two-lobster confirmation relay | `nemoclaw-clawdia-reef` | Pass | 2/2 OpenClaw agents completed, coordinated relay outputs preserved |
| Tiny website artifact team | `nemoclaw-captain-bridge` | Pass | 2/2 agents completed, `index.html` and `styles.css` were available through the artifact API |
| OpenShell deny-first policy team | `nemoclaw-pearl-script` | Pass | 2/2 agents completed, direct outbound request was denied by OpenShell/proxy policy |
| Weather skill readiness team | `nemoclaw-snips-workbench` | Pass | 2/2 agents completed, `weather` skill readiness was present in diagnostics |

## Fixes Made During Validation

- Added a backend semaphore for OpenClaw team runs so extra accepted sandbox
  runs queue instead of overloading a smaller model route.
- Added `OFFICE_AGENTS_SANDBOX_MAX_CONCURRENT_OPENCLAW_RUNS` so Spark can stay
  conservative while GB300/vLLM can be tuned upward.
- Fixed the queue progress event to use the keyword-only backend helper
  correctly.
- Added backend exception diagnostics so unexpected task crashes become
  visible `backend_exception` run failures instead of stale `running` UI state.
- Normalized stale non-terminal run metadata in status/diagnostics responses.
- Promoted multi-sandbox booth validation to `scripts/demo_multisandbox_suite.py`.
- Made the validation suite clean up intended temporary profiles even after a
  request timeout.
- Made the validation suite use queue-aware timeouts and poll cancellation to a
  terminal state.

## Known Warnings

These are expected on the current Spark fallback host:

- `BRAVE_API_KEY` is missing, so web/deep-research demos that require Brave
  should be avoided or configured before visitors use them.
- OpenShell has pending network rule recommendations. This is useful for
  policy demos, but the operator should be ready to explain approve/reject.
- Hermes is not configured, so crabs are visual/build/assign only until
  `OFFICE_AGENTS_HERMES_COMMAND` is set to a real runner.
