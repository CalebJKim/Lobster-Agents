# Lobster Agents

NemoClaw Reef is a local demo environment for visible OpenClaw agent profiles
running inside NemoClaw/OpenShell sandboxes. The frontend renders the reef in
Three.js; the backend owns the live agent roster, sandbox assignments, policy
state, and OpenClaw relay runs.

The current demo path is:

- React/Vite frontend on `:4454`
- FastAPI backend on `:8001`
- OpenAI-compatible inference endpoint, usually vLLM on a demo device
- NemoClaw and OpenShell CLIs available on the backend host
- NemoClaw sandboxes created on that same backend host

## New Device Setup

Cloning this repository does not create NemoClaw/OpenShell sandboxes. Sandboxes
are local runtime objects on the demo device, so a new machine must build its
own sandboxes after the repo is pulled. Do not hardcode another machine's IP or
sandbox paths into source; configure them with environment variables.

Recommended flow on a fresh demo device:

```bash
git clone https://github.com/CalebJKim/Lobster-Agents.git
cd Lobster-Agents
```

Install or verify the runtime tools:

```bash
command -v openshell
command -v nemoclaw
command -v openclaw
```

Start or point at an OpenAI-compatible model endpoint. For vLLM, the backend
expects a `/v1` API root:

```bash
export OFFICE_AGENTS_LLM_BASE_URL="http://<demo-device-ip-or-host>:8000/v1"
export OFFICE_AGENTS_LLM_MODEL="<served-model-name>"
export OFFICE_AGENTS_LLM_API_KEY="dummy"
```

The backend model route and the NemoClaw sandbox route can be different. The
backend can use a host-loopback endpoint, but OpenShell sandboxes must use a
NemoClaw-supported provider that is reachable through `inference.local`.
Override these when the sandbox should use a different provider/model:

```bash
export OFFICE_AGENTS_NEMOCLAW_PROVIDER="custom"   # or "ollama" on Spark-style hosts
export OFFICE_AGENTS_NEMOCLAW_ENDPOINT_URL="http://<sandbox-reachable-model-host>:8000/v1"
export OFFICE_AGENTS_NEMOCLAW_MODEL="<sandbox-routed-model-name>"
export OFFICE_AGENTS_NEMOCLAW_API_KEY="dummy"
```

On Spark hosts with Ollama already exposed through OpenShell, a working pair is
usually `OFFICE_AGENTS_NEMOCLAW_PROVIDER=ollama` and
`OFFICE_AGENTS_NEMOCLAW_MODEL=qwen3.6:35b-a3b`. Verify from a sandbox with
`curl -sk https://inference.local/v1/models`; if that returns
`inference service unavailable`, fix the OpenShell/NemoClaw inference route
before running agent tasks.

When the model server is vLLM/llama.cpp bound only to host loopback
(`127.0.0.1:8000`), OpenShell sandboxes cannot reach it through the Docker
bridge without a host-side bridge. Keep the model server untouched and expose
only the bridge IP that `host.openshell.internal` resolves to:

```bash
# Example for Spark where host.openshell.internal resolves to 172.18.0.1.
nohup python3 scripts/vllm_bridge_proxy.py \
  --bind-host 172.18.0.1 \
  --bind-port 8000 \
  --upstream-host 127.0.0.1 \
  --upstream-port 8000 \
  >/tmp/vllm-bridge-proxy.log 2>&1 &
openshell provider update compatible-endpoint \
  --config OPENAI_BASE_URL=http://host.openshell.internal:8000/v1
openshell inference update --timeout 180 --no-verify
openshell sandbox exec --name <sandbox> --timeout 20 --no-tty -- \
  curl -sk https://inference.local/v1/models
```

The bridge script should bind the Docker bridge address on port `8000` and
forward to `127.0.0.1:8000`. If `inference.local` does not return the model
list from inside a sandbox, OpenClaw task runs will fail even though the
backend `/health` endpoint can reach the model directly.

Build the NemoClaw sandboxes on the same host that runs the backend. The four
default demo workspace names are:

```bash
for sandbox in \
  nemoclaw-clawdia-reef \
  nemoclaw-captain-bridge \
  nemoclaw-pearl-script \
  nemoclaw-snips-workbench
do
  nemoclaw onboard \
    --non-interactive \
    --yes \
    --yes-i-accept-third-party-software \
    --name "$sandbox" \
    --no-gpu \
    --no-sandbox-gpu
done
```

Check that NemoClaw sees them:

```bash
nemoclaw status --json
```

If the UI says a sandbox is configured but not live, the repo is not the
missing piece. Create or start that sandbox on the backend host, verify
`nemoclaw status --json`, then refresh the UI.

## Local Development

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
OFFICE_AGENTS_LLM_BASE_URL="http://127.0.0.1:8000/v1" \
OFFICE_AGENTS_LLM_MODEL="qwen3.6-27b-mtp" \
OFFICE_AGENTS_LLM_API_KEY="dummy" \
python -m uvicorn --app-dir src office_agents.main:app --host 0.0.0.0 --port 8001
```

Frontend:

```bash
cd frontend
npm install
VITE_BACKEND="http://127.0.0.1:8001" npm run dev -- --host 0.0.0.0 --port 4454
```

Use `VITE_BACKEND=http://<backend-host>:8001` when the frontend runs on a
different laptop from the backend. The frontend source should not contain a
machine-specific fallback IP.

## Policies And Approvals

There are two separate policy layers:

- NemoClaw policy presets expose coarse sandbox capability bundles such as
  `brave`, `github`, `npm`, `pypi`, and `huggingface`.
- OpenShell network rules are approval-after-deny recommendations. If a sandbox
  tries an outbound request that is not currently allowed, OpenShell denies it,
  records the attempted access, and proposes a minimal rule. The Policies tab
  can approve, reject, revoke, approve all, or clear pending rules through
  `openshell rule`.

Resetting the reef UI clears app/task state. It does not erase approved
OpenShell network rules. Change rules only through the explicit rule actions in
the Policies tab.

## Skills

The Build a Claw UI can request OpenClaw skills for a profile. Requested skills
are not assumed ready just because they appear in the static catalog; run
status and the Status tab show live OpenClaw readiness, including installed,
ready, needs-setup, and install-failed states.

Skills that require credentials or binaries need setup inside the sandbox or
OpenClaw profile. The UI should surface readiness instead of silently treating
metadata as truth.

## Sandboxes

The four default sandboxes are starter workspaces, not a fixed limit. The
Workspaces dock can create another sandbox on the backend host:

1. Persist the display name and generated internal sandbox name in the backend
   SQLite store.
2. Create the live NemoClaw sandbox on the backend host.
3. Refresh `/sandboxes`; the frontend renders the new workspace and the Three.js
   map spawns a new hut.

Internal sandbox names should be stable, URL-safe, and machine-agnostic, for
example `nemoclaw-demo-lab`. Display names can be changed in the UI without
renaming the underlying sandbox.

## Crabs / Hermes Agents

Crabs are the intended visual and UI representation for Hermes-backed agents.
They should follow the same philosophy as lobsters:

- visible profiles in the reef
- assignable to NemoClaw/OpenShell sandboxes
- honest runtime metadata in the UI
- no fake capability claims when the Hermes runtime is unavailable

The integration uses OpenShell/NemoClaw boundaries for filesystem and network
isolation. Crab profiles route to the Hermes bridge. Configure a real Hermes
runner on the backend host with:

```bash
export OFFICE_AGENTS_HERMES_COMMAND='hermes run "$HERMES_TASK"'
```

The command runs inside the assigned OpenShell sandbox with `HERMES_TASK`,
`HERMES_AGENT_NAME`, `HERMES_ROLE`, and `HERMES_PERSONALITY` in the environment.
If a demo device does not have Hermes installed or configured, crab runs fail
with a clear `hermes_not_configured` diagnostic instead of falling back silently
to a lobster/OpenClaw run.

## Architecture

```text
Frontend (React + Three.js + Vite)
    | REST + WebSocket
    v
Backend (FastAPI)
    | OpenAI-compatible API
    v
vLLM / other local model server

Backend
    | nemoclaw / openshell / openclaw CLIs
    v
NemoClaw sandboxes backed by OpenShell policy enforcement

Backend
    | SQLite
    v
Agent memory, history, sandbox display names, dynamic sandbox registry
```

Important backend packages:

- `office_agents.agents`: visible agent profiles, prompts, memory, orchestrator
- `office_agents.sandbox_runtime`: NemoClaw/OpenShell/OpenClaw integrations
- `office_agents.office`: SQLite persistence and shared reef state
- `office_agents.routes`: FastAPI REST and WebSocket routes

Important frontend packages:

- `components/ThreeUnderwaterMap.tsx`: reef scene and sandbox huts
- `components/SandboxOrchestrator.tsx`: sandbox/team dock
- `components/SandboxRunPanel.tsx`: run diagnostics, policies, OpenShell rules
- `components/LobsterBuilder.tsx`: OpenClaw profile builder

## Validation

After code changes:

```bash
cd backend
python -m compileall src

cd ../frontend
npm run build
```

Manual demo checks:

- `/health` reports the model, NemoClaw, and OpenShell as available.
- `/sandboxes` shows configured and live sandboxes separately.
- A newly created sandbox appears in the dock and on the Three.js map.
- Build a Claw spawns a visible profile with color/accessories intact.
- Assigning a profile to a sandbox moves it into the matching hut.
- A denied outbound request creates an OpenShell network-rule recommendation in
  the Policies tab.
