# NemoClaw Reef

NemoClaw Reef is a visual workbench for NemoClaw/OpenShell sandboxes. It shows live sandbox workspaces, visible OpenClaw agents, policy state, network-rule recommendations, run output, diagnostics, and artifacts in one browser UI.

The reef demo skin is part of the product, but the primary purpose is simple: make NemoClaw usable as an operator-facing visual control plane.

## What Runs

- vLLM OpenAI-compatible server on `:8000`
- FastAPI backend on `:8001`
- React/Vite frontend on `:4454`
- NemoClaw/OpenShell/OpenClaw on the same host as the backend

OpenShell sandboxes reach the local model through:

```text
http://host.openshell.internal:8000/v1
```

## Requirements

Install or provide these on the demo/workbench host:

```bash
command -v git python3 npm openshell nemoclaw openclaw
```

The validated demo path also expects an NVIDIA GPU, working drivers, and enough VRAM for the configured vLLM model.

## Quickstart

```bash
git clone <repo-url>
cd <repo-dir>

VLLM_INSTALL_IF_MISSING=1 scripts/gb300_launch_vllm.sh
scripts/demo_station_setup.sh
scripts/gb300_launch_reef.sh
```

Open the frontend:

```text
http://<host>:4454
```

## Daily Start

```bash
scripts/gb300_launch_vllm.sh
scripts/demo_station_setup.sh
scripts/gb300_launch_reef.sh
```

Restart vLLM explicitly:

```bash
VLLM_RESTART=1 scripts/gb300_launch_vllm.sh
scripts/demo_station_setup.sh
scripts/gb300_launch_reef.sh
```

## Runtime Defaults

`scripts/gb300_launch_vllm.sh` defaults to the current validated local model route:

```text
VLLM_MODEL=Qwen/Qwen3.6-27B-FP8
VLLM_SERVED_MODEL_NAME=qwen3.6-27b-fp8
VLLM_PORT=8000
VLLM_ENABLE_AUTO_TOOL_CHOICE=1
VLLM_TOOL_CALL_PARSER=qwen3_xml
```

The backend reads `NEMOCLAW_REEF_*` environment variables. The old `OFFICE_AGENTS_*` prefix is still mapped as a temporary compatibility layer.

Useful backend settings:

```text
NEMOCLAW_REEF_LLM_BASE_URL=http://127.0.0.1:8000/v1
NEMOCLAW_REEF_LLM_MODEL=qwen3.6-27b-fp8
NEMOCLAW_REEF_NEMOCLAW_ENDPOINT_URL=http://host.openshell.internal:8000/v1
NEMOCLAW_REEF_AUTONOMY_ENABLED=true
NEMOCLAW_REEF_SANDBOX_MAX_CONCURRENT_OPENCLAW_RUNS=2
```

Set `NEMOCLAW_REEF_AUTONOMY_ENABLED=false` to disable idle reef chatter. Manual queries and sandbox task runs still work.

## Starter Sandboxes

The demo setup script creates or syncs these starter sandboxes:

```text
nemoclaw-clawdia-reef
nemoclaw-captain-bridge
nemoclaw-pearl-script
nemoclaw-snips-workbench
```

Inspect live sandbox state:

```bash
nemoclaw status --json
```

If the UI shows a sandbox as not live, rerun:

```bash
scripts/demo_station_setup.sh
```

## Validate

Backend unit tests:

```bash
cd backend
python -m pytest -q
```

Frontend build/typecheck:

```bash
cd frontend
npm run build
```

End-to-end demo smoke test when the stack is running:

```bash
python3 scripts/demo_e2e.py \
  --base http://127.0.0.1:4454 \
  --sandbox nemoclaw-snips-workbench \
  --task-timeout-seconds 420 \
  --json
```

## Operator Flow

1. Open the reef UI.
2. Click **Demo Ready** and clear blockers.
3. Build or select OpenClaw-capable agents.
4. Assign agents to a live NemoClaw sandbox.
5. Run a quick task such as **Relay Check**.
6. Inspect run timeline, console output, diagnostics, artifacts, policies, and network-rule recommendations.
7. Use **Clean Demo** between sessions.

Clean Demo resets UI/demo state and wipes starter sandbox work/run directories. It does not destroy live NemoClaw/OpenShell sandboxes.

## Repository Shape

```text
backend/src/nemoclaw_reef/
  integrations/   NemoClaw, OpenShell, OpenClaw, Hermes, and subprocess adapters
  services/       sandbox assignment and run coordination
  agents/         reef agent profiles and orchestration
  reef/           autonomous chat and general query workflow
  routes/         FastAPI route modules
  state/          reef state, layout, and persistence

frontend/src/
  components/     reef UI, sandbox monitor, builder, panels
  hooks/          websocket transport and derived UI state
  utils/          sandbox API client, config, sprites, demo scenarios
```

The route paths remain stable for the current UI. Internal package names and env vars now reflect NemoClaw Reef.
