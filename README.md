# Lobster Agents

NemoClaw Reef is a local demo environment for visible OpenClaw agent profiles
running inside NemoClaw/OpenShell sandboxes. The frontend renders the reef in
Three.js; the backend owns the live agent roster, sandbox assignments, policy
state, and OpenClaw relay runs.

The current demo path is:

- React/Vite frontend on `:4454`
- FastAPI backend on `:8001`
- OpenAI-compatible inference endpoint, usually vLLM on the GB300 demo device
  or the Spark fallback model route
- NemoClaw and OpenShell CLIs available on the backend host
- NemoClaw sandboxes created on that same backend host

## Current Deployment Topologies

The app is machine-agnostic, but the backend, OpenShell gateway, NemoClaw
sandboxes, and sandbox-reachable inference route must agree with each other.
Do not commit demo-device IPs or personal credentials into source.

Supported demo shapes:

- **GB300 / DGX Station path**: preferred when the station is reachable. Run the
  model server with vLLM or another OpenAI-compatible server, run the FastAPI
  backend on the same host as OpenShell/NemoClaw, and point both backend and
  NemoClaw inference settings at the GB300 model route.
- **Spark fallback path**: useful when the station is offline. Spark has been
  used with `qwen3.6:35b-a3b` behind an OpenAI-compatible or Ollama-style route.
  Treat its IP as operator config, not repository state.
- **Mac frontend + remote backend**: common for demos. The browser opens
  `http://localhost:4454` on the Mac, while `VITE_BACKEND` points to the remote
  backend on GB300 or Spark. Sandboxes still live on the backend host.

The rule of thumb is simple: the UI can run anywhere, but executable agent work
happens where the backend and NemoClaw/OpenShell sandboxes run. If you move to a
new device, rebuild or create sandboxes on that device.

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

On GB300 with vLLM, keep the value model-specific and environment-specific:

```bash
export OFFICE_AGENTS_LLM_BASE_URL="http://<gb300-host-or-ip>:<vllm-port>/v1"
export OFFICE_AGENTS_LLM_MODEL="<vllm-served-model-id>"
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

For GB300/vLLM, the usual NemoClaw setting is the OpenAI-compatible custom
provider:

```bash
export OFFICE_AGENTS_NEMOCLAW_PROVIDER="custom"
export OFFICE_AGENTS_NEMOCLAW_ENDPOINT_URL="http://<sandbox-reachable-gb300-host>:<vllm-port>/v1"
export OFFICE_AGENTS_NEMOCLAW_MODEL="<vllm-served-model-id>"
export OFFICE_AGENTS_NEMOCLAW_API_KEY="dummy"
```

OpenClaw relay concurrency is intentionally configurable. Spark-class fallback
hosts should usually run one active OpenClaw team run at a time because multiple
simultaneous multi-agent relays can overload the smaller model route. GB300 with
vLLM should be able to run higher because vLLM batches well and the station has
more VRAM/throughput. Start conservative, then increase while watching the Demo
Ready panel, task timelines, and backend logs:

```bash
# Spark fallback reliability default
export OFFICE_AGENTS_SANDBOX_MAX_CONCURRENT_OPENCLAW_RUNS=1

# GB300/vLLM candidate values to validate on that machine
export OFFICE_AGENTS_SANDBOX_MAX_CONCURRENT_OPENCLAW_RUNS=2
# then try 3, 4, etc. only after multi-sandbox validation stays green
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

The UI can also create additional sandboxes through the Workspaces dock. That
persists the sandbox metadata in the backend SQLite store and provisions a live
NemoClaw sandbox on the backend host. This still requires `openshell`,
`nemoclaw`, model routing, and policies to be correctly installed on that host.
By default, the reef map shows only the four starter sandboxes plus sandboxes
created through this app. Other live NemoClaw sandboxes on the host stay hidden
unless `OFFICE_AGENTS_SHOW_UNREGISTERED_LIVE_SANDBOXES=true` is set.

Public GitHub clones do not require GitHub credentials:

```bash
git clone https://github.com/CalebJKim/Lobster-Agents.git
```

Do not install write-capable GitHub keys on a demo station unless that station
is intentionally allowed to push code.

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

For a Mac frontend talking to a remote GB300 or Spark backend:

```bash
cd frontend
VITE_BACKEND="http://<backend-host-or-ip>:8001" npm run dev -- --host 0.0.0.0 --port 4454
```

The backend should be started on the host that owns the live OpenShell/NemoClaw
sandboxes.

## Demo Operator Checklist

Before a live demo, open `http://localhost:4454` and click **Demo Ready**.
The panel is the source of truth for demo health:

- **Blockers** must be zero.
- **Warnings** are allowed if you can explain them. Common expected warnings
  are missing `BRAVE_API_KEY`, pending OpenShell network-rule recommendations,
  and Hermes not configured.
- **Hermes not configured** means crabs are visual/build/assign only. Use the
  Task Monitor's lobster-only run path for executable demos.
- **Pending network rules** mean OpenShell denied an outbound attempt and has a
  proposed approval ready in the Policies tab.

Recommended live flow:

1. Click **Demo Ready** and copy the readiness summary if you need a proof note.
2. Build one lobster with a generated or preset headwear item.
3. Build one crab and point out the Hermes readiness badge.
4. Create or select a live sandbox.
5. Drag the lobster and crab into the sandbox to show mixed teams.
6. Run the **Relay Check** quick-start with two OpenClaw lobsters.
7. Open **Run + Outputs** to show the timeline and copyable run summary.
8. Open **Policies** to show NemoClaw presets and OpenShell network rules.
9. Open **Console** and use filters to show agent/stdout/stderr traces.
10. Use the E2E harness for a machine-verifiable check:

```bash
./scripts/demo_e2e.py --sandbox nemoclaw-demo-e2e-0530182359 --json
```

The E2E harness creates temporary profiles, validates accessories and crabs,
toggles/restores a policy, loads network rules, runs a two-lobster OpenClaw
relay, checks diagnostics, and cleans up. It should pass before demo time.

For the broader booth validation suite:

```bash
./scripts/demo_booth_suite.py \
  --sandbox nemoclaw-demo-e2e-0530182359 \
  --scenarios readiness,profiles,edges,policies,web,reset \
  --json
```

For a slower proof that multiple distinct OpenClaw teams can work across
multiple live NemoClaw/OpenShell sandboxes:

```bash
./scripts/demo_multisandbox_suite.py --max-workers 2 --json
```

On Spark, this intentionally proves backend queueing more than raw parallel
throughput. On GB300/vLLM, increase both
`OFFICE_AGENTS_SANDBOX_MAX_CONCURRENT_OPENCLAW_RUNS` and `--max-workers`
together until latency or failure rate says to stop.

Use the slower scenarios intentionally:

```bash
./scripts/demo_booth_suite.py --sandbox nemoclaw-demo-e2e-0530182359 --scenarios coding --json
./scripts/demo_booth_suite.py --sandbox nemoclaw-demo-e2e-0530182359 --scenarios denial --json
```

Generated Markdown/JSON reports are written under `reports/`. The latest
consolidated booth summary is `reports/demo_booth_validation_summary.md`.

Between visitors, use **Clean Demo** in the Workspaces dock. It cancels active
runs, clears assignments/run UI state, deletes visitor-created lobsters/crabs,
archives and wipes starter sandbox work/run directories, removes extra app
sandbox registrations, and returns the map to the four starter huts. It does
not destroy live NemoClaw/OpenShell sandboxes on the host.

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

## Visitor Agent Exports

Visitor-built lobsters and crabs are saved in the backend SQLite store as
exportable agent profiles. Each profile exposes:

- `GET /lobsters/{name}/passport` for portable JSON metadata
- `GET /lobsters/{name}/portrait.svg` for a visual keepsake
- `GET /lobsters/{name}/export` for a zip containing `agent.json`,
  `portrait.svg`, `README.md`, and `install-openclaw-agent.sh`

The sidebar profile chip includes a **Save** action for downloading the zip.
Clean Demo deletes visitor profiles from the live roster and saved export
store, so export before cleaning if a visitor wants to keep their agent.

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
- **Demo Ready** reports zero blockers. Expected warnings must be explainable.
- `/sandboxes` shows configured and live sandboxes separately.
- A newly created sandbox appears in the dock and on the Three.js map.
- Build a Claw spawns a visible profile with color/accessories intact.
- Assigning a profile to a sandbox moves it into the matching hut.
- A short relay task completes with two OpenClaw lobsters and preserves both
  per-agent outputs in diagnostics.
- A simple coding task can produce `index.html`/`styles.css`, and the Status
  tab exposes them under Run artifacts.
- A denied outbound request creates an OpenShell network-rule recommendation in
  the Policies tab.
- Missing `BRAVE_API_KEY` blocks or warns for web/deep-research demos instead
  of letting the visitor wait on a doomed run.
