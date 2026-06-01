# 2-4 Minute Booth Workflows - 2026-06-01

Validated against the live Spark fallback stack through `http://localhost:4454`.

## Recommended Visitor Workflows

| Workflow | Time | Tested | What to Show |
| --- | ---: | --- | --- |
| Build + assign a visual team | 1 minute | PASS as part of smoke suite | Build a lobster with generated headwear, build a Hermes crab, drag both into a live sandbox, explain runtime badges. |
| Two-lobster relay check | 2 minutes | PASS, `110s` | Two OpenClaw lobsters each reply with one sentence; show Run + Outputs and per-agent diagnostics. |
| OpenShell policy denial | 2 minutes | PASS, `112.5s` | Ask one lobster to try `https://example.com`; show denied CONNECT and pending network-rule recommendation. |
| Static website generation | 3 minutes | PASS, `165.8s` | Ask one lobster to create `index.html` and `styles.css`; open generated artifacts from Status tab. |
| Policy toggle walkthrough | 30 seconds | PASS as part of smoke suite | Dry-run/apply/restore `npm` or another non-sensitive preset; show OpenShell rules remain separate. |
| Demo Ready + system explanation | 30 seconds | PASS | Show `9 ok / 3 warn / 0 fail`; explain Brave, Hermes, and pending-rule warnings. |

## Parallel Test

Three workflows ran at the same time on separate live sandboxes:

- `nemoclaw-clawdia-reef`: smoke/readiness/profile/policy/reset suite, `32.93s`, `6 pass / 0 warn / 0 fail`.
- `nemoclaw-pearl-script`: OpenShell denial workflow, `119.24s` total, task runtime `112.5s`, PASS.
- `nemoclaw-captain-bridge`: static website workflow, `172.17s` total, task runtime `165.8s`, PASS.

The app is suitable for parallel booth lanes as long as each active task uses a
different sandbox. One active task per sandbox is the correct operating model.

## Tested Evidence

- Smoke suite: `reports/demo_booth_validation_0601094903-24129.md`
- Policy denial: `reports/demo_booth_validation_0601094902-24118.md`, run `nemoclaw-pearl-script-9ed83805`
- Static website: `reports/demo_booth_validation_0601094904-24140.md`, run `nemoclaw-captain-bridge-6de3ee11`
- Quick relay: `nemoclaw-snips-workbench-d29318af`, two OpenClaw agents succeeded in `110s`

## Parallel Harness Fix

The first parallel validation attempt exposed a test-harness collision: multiple
suite processes started in the same second and used the same temporary profile
names/report file names. `scripts/demo_booth_suite.py` now appends the process
ID to the timestamp stamp, making concurrent validation runs safe.

## Suggested Scripted Prompts

### Two-Lobster Relay

```text
Each lobster reply with one sentence confirming the Reef collaboration works.
Do not use web search, browser, files, or shell.
```

### OpenShell Denial

```text
Do not use web_search. Try a direct outbound request to https://example.com
from inside the sandbox. If OpenShell denies it, report the exact denial and stop.
```

### Static Website

```text
Create a tiny static website about Lobster Agents. Make index.html and styles.css.
Keep it simple. Report the files created.
```

### Policy Toggle

Use the Policies tab:

1. Choose a preset such as `npm`.
2. Run dry-run.
3. Apply disable.
4. Apply restore.
5. Show OpenShell network rules separately.

## Boundaries

- Use separate sandboxes for parallel tasks.
- Do not use live web/deep research until `BRAVE_API_KEY` is configured.
- Do not present Hermes crabs as executable until `OFFICE_AGENTS_HERMES_COMMAND` is configured.
- Keep visitor tasks bounded to avoid long model/tool loops.
