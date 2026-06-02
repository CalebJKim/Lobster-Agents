# Lobster Agents

NemoClaw Reef is a local demo app for visible OpenClaw agents running inside
NemoClaw/OpenShell sandboxes. Visitors build lobsters, assign them to sandbox
workspaces, toggle policies, and run team tasks against a local vLLM model.

This README describes the supported booth path: **one Linux demo station with
vLLM, NemoClaw/OpenShell, the backend, and the frontend all running on that
station**.

## What Runs

- vLLM OpenAI-compatible server: `:8000`
- FastAPI backend: `:8001`
- React/Vite frontend: `:4454`
- NemoClaw/OpenShell sandboxes on the same host as the backend

OpenShell sandboxes reach the model through:

```text
http://host.openshell.internal:8000/v1
```

Do not hardcode demo-station IPs, tokens, or personal credentials into source.

## Requirements

On the demo station:

- NVIDIA GPU and drivers
- Python 3.12 or compatible Python 3
- Node.js/npm
- Git
- `openshell`
- `nemoclaw`
- `openclaw`

Quick check:

```bash
command -v git python3 npm openshell nemoclaw openclaw
```

## First-Time Setup

Clone the public repo:

```bash
git clone https://github.com/CalebJKim/Lobster-Agents.git
cd Lobster-Agents
```

Start vLLM. On a fresh machine, allow the helper to install vLLM into
`$HOME/vllm-venv`:

```bash
VLLM_INSTALL_IF_MISSING=1 scripts/gb300_launch_vllm.sh
```

Prepare OpenShell/NemoClaw for the local vLLM route and create the four starter
sandboxes if they do not already exist:

```bash
scripts/demo_station_setup.sh
```

Start the backend and frontend:

```bash
scripts/gb300_launch_reef.sh
```

Open:

```text
http://<demo-station-ip>:4454
```

For the current GB300 over Tailscale, that is:

```text
http://100.102.251.37:4454
```

## Daily Booth Start

From the repo on the demo station:

```bash
git pull --ff-only
scripts/gb300_launch_vllm.sh
scripts/demo_station_setup.sh
scripts/gb300_launch_reef.sh
```

If you need to restart the model server:

```bash
VLLM_RESTART=1 scripts/gb300_launch_vllm.sh
scripts/demo_station_setup.sh
scripts/gb300_launch_reef.sh
```

## vLLM Defaults

`scripts/gb300_launch_vllm.sh` defaults to the validated booth model:

```text
VLLM_MODEL=Qwen/Qwen3.6-27B-FP8
VLLM_SERVED_MODEL_NAME=qwen3.6-27b-fp8
VLLM_PORT=8000
CUDA_VISIBLE_DEVICES=0
VLLM_ENABLE_AUTO_TOOL_CHOICE=1
VLLM_TOOL_CALL_PARSER=qwen3_xml
```

The tool-call flags are required for OpenClaw. Without them, vLLM rejects
OpenClaw requests with an error like:

```text
"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser
```

If your station maps the large GPU to a different CUDA index, override it:

```bash
CUDA_VISIBLE_DEVICES=1 scripts/gb300_launch_vllm.sh
```

The NVFP4/MTP Qwen route is not the default. Use the FP8 route above for the
booth unless you have separately validated the NVFP4 model on that station.

## Starter Sandboxes

The app expects four starter NemoClaw sandboxes:

```text
nemoclaw-clawdia-reef
nemoclaw-captain-bridge
nemoclaw-pearl-script
nemoclaw-snips-workbench
```

`scripts/demo_station_setup.sh` creates missing starter sandboxes and syncs
their inference route to `qwen3.6-27b-fp8`.

To inspect sandbox health:

```bash
nemoclaw status --json
```

If the UI says a sandbox is not live, run:

```bash
scripts/demo_station_setup.sh
```

then refresh the browser.

## Validate Before Visitors

Check the UI:

1. Open the reef.
2. Click **Demo Ready**.
3. Confirm there are zero blockers.

Expected warning:

```text
Hermes crab runtime not configured
```

That means crabs are visual/build/assign only. OpenClaw lobsters are the
executable demo path.

Run the automated E2E:

```bash
python3 scripts/demo_e2e.py \
  --base http://127.0.0.1:4454 \
  --sandbox nemoclaw-snips-workbench \
  --task-timeout-seconds 420 \
  --json
```

Pass criteria:

- profile creation works
- lobster accessories persist
- crab profiles render and assign
- policy dry-run/apply/restore works
- OpenShell network rules endpoint loads
- two OpenClaw lobsters complete a sandbox relay
- diagnostics report success

## Visitor Flow

In 2-4 minutes:

1. Click **Demo Ready**.
2. Build a lobster with a color and hat.
3. Build a crab and explain the Hermes readiness badge.
4. Drag two OpenClaw lobsters into a live sandbox.
5. Run the **Relay Check** quick task.
6. Open **Run + Outputs** to show timeline, outputs, diagnostics, and summary.
7. Open **Policies** to show NemoClaw presets and OpenShell network rules.
8. Click **Clean Demo** between visitors.

## Clean Demo

Use **Clean Demo** in the UI between visitors. It:

- cancels active runs
- clears assignments and run UI state
- deletes visitor-created lobsters/crabs
- wipes starter sandbox work/run directories
- clears pending OpenShell network-rule recommendations
- removes extra app-created sandbox registrations
- returns the reef map to the four starter workspaces

It does **not** destroy live NemoClaw/OpenShell sandboxes and does **not**
erase approved or rejected OpenShell network rules.

## Policies

There are two policy layers:

- **NemoClaw presets**: coarse capability bundles such as `npm`, `pypi`,
  `huggingface`, `brew`, `github`, and `brave`.
- **OpenShell network rules**: approval-after-deny recommendations. If a
  sandbox tries a blocked outbound request, OpenShell denies it, records the
  attempted access, and proposes a minimal rule in the Policies tab.

Approve/reject network rules only through the Policies tab or `openshell rule`.

## Skills

Build a Claw can request OpenClaw skills. The UI shows live readiness instead
of trusting static metadata:

- ready
- needs setup
- missing dependency
- install failed

For a booth, prefer simple built-in profile traits unless you have validated a
specific skill on that station.

## Visitor Agent Exports

Visitor-built profiles can be saved before cleanup:

- `GET /lobsters/{name}/passport`
- `GET /lobsters/{name}/portrait.svg`
- `GET /lobsters/{name}/export`

The sidebar profile chip includes a **Save** action for a zip containing the
agent metadata, portrait, README, and an OpenClaw install helper.

## Useful Commands

Show runtime ports:

```bash
ss -ltnp | grep -E '(:8000|:8001|:4454)'
```

Tail logs:

```bash
tail -f /tmp/lobster-vllm.log
tail -f /tmp/lobster-backend.log
tail -f /tmp/lobster-frontend.log
```

Read readiness from the terminal:

```bash
curl -fsS 'http://127.0.0.1:8001/demo/readiness?sandbox_name=nemoclaw-snips-workbench'
```

Check the vLLM model:

```bash
curl -fsS http://127.0.0.1:8000/v1/models
```

Check the sandbox-to-model route:

```bash
openshell sandbox exec \
  --name nemoclaw-snips-workbench \
  --workdir /sandbox \
  --timeout 20 \
  -- \
  curl -sk https://inference.local/v1/models
```

## Troubleshooting

**Frontend loads but Demo Ready says model unavailable**

```bash
scripts/gb300_launch_vllm.sh
scripts/demo_station_setup.sh
```

**OpenClaw says vLLM rejected tool payload**

Restart vLLM with the checked-in helper:

```bash
VLLM_RESTART=1 scripts/gb300_launch_vllm.sh
```

The helper enables `--enable-auto-tool-choice --tool-call-parser qwen3_xml`.

**Sandbox is not live**

```bash
scripts/demo_station_setup.sh
nemoclaw status --json
```

**Backend or frontend is stale**

```bash
scripts/gb300_launch_reef.sh
```

The launcher refreshes the backend editable install, starts the backend on
`:8001`, starts the frontend on `:4454`, and leaves already-healthy services
alone.
