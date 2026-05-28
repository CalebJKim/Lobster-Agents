# Office Agents

A pixel-art virtual office where 7 AI agents collaborate to solve your problems — research, analysis, fact-checking, code generation — all running **100% locally** on an NVIDIA DGX Spark. Nothing leaves your network.

**"That's my research team." / "Those are AIs?" / "Yeah. Running on this box under my desk."**

![Stack](https://img.shields.io/badge/React_19-PixiJS_8-blue) ![Stack](https://img.shields.io/badge/FastAPI-WebSocket-green) ![Stack](https://img.shields.io/badge/Qwen_3.5_35B-Ollama-orange) ![Stack](https://img.shields.io/badge/100%25_Local-Private-red)

## What It Does

You type a question. 7 AI agents visually move to the War Room, research the web, fact-check each other, and write a structured answer on the whiteboard — all in real-time with a pixel-art office visualization.

**Agents:**
| Agent | Role | What they do |
|-------|------|-------------|
| Sam | Lead | Coordinates the team, asks you for clarification |
| Maya | Researcher | Searches the web via Tavily/DuckDuckGo |
| Sophie | Critic | Fact-checks Maya's findings with independent searches |
| Raj | Analyst | Ranks, compares, and structures data |
| Jordan | Writer | Writes the final deliverable on the whiteboard |
| Dev | Coder | Writes code via Claude Code CLI |
| Alex | Planner | Structures complex multi-step tasks |

**Key Features:**
- Pixel-art office with PixiJS — watch agents walk, talk, and work
- Pokemon RPG-style dialogue boxes on the canvas
- Water cooler mode — agents chat about random topics when idle
- Drag-and-drop files — agents read your private CSVs, docs, etc.
- Web search (Tavily + DuckDuckGo fallback)
- Code generation via Claude Code CLI
- Typewriter whiteboard animation
- Pokemon-style sound effects
- Query history persisted in SQLite
- Parallel agent execution for faster results
- Docker deployment with one command

---

## Quick Start (Docker)

**Prerequisites:** NVIDIA GPU + [Ollama](https://ollama.com) running on the host with `qwen3.5:35b` pulled.

```bash
# 1. Clone
git clone https://github.com/kedars-opencode-agent/agent-office.git
cd agent-office

# 2. Pull the model (if not already done)
ollama pull qwen3.5:35b

# 3. Start with Docker Compose
OLLAMA_HOST=$(hostname -I | awk '{print $1}') \
TAVILY_API_KEY=your-tavily-key \
docker compose up -d

# 4. Open in browser
echo "http://$(hostname -I | awk '{print $1}'):4454"
```

That's it. Two containers (backend + frontend) connect to your host Ollama.

### Self-contained (Ollama in Docker too)

For a fresh machine with NVIDIA Container Toolkit:

```bash
TAVILY_API_KEY=your-key docker compose -f docker-compose.full.yml up -d
```

This pulls Ollama, the model, and everything. First start takes a while.

---

## Quick Start (Bare Metal)

```bash
# 1. Start Ollama
OLLAMA_HOST=0.0.0.0 ollama serve &
ollama pull qwen3.5:35b

# 2. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install .
cp .env.example .env  # edit with your settings
uvicorn office_agents.main:app --host 0.0.0.0 --port 8001

# 3. Frontend (separate terminal)
cd frontend
npm install
npx vite --host 0.0.0.0 --port 4454
```

Or use the all-in-one script (designed for DGX Spark):

```bash
bash start.sh
```

---

## Dev Workflow (Mac laptop ↔ Spark backend)

Day-to-day setup: code lives on the laptop at `~/dev/lobster-agents/`, frontend runs locally via Vite at `http://localhost:4454`, backend + Ollama run on the Spark at `10.110.23.141:8001`. The Vite dev server proxies `/state`, `/lobsters`, `/sandboxes`, WebSocket, etc. to the Spark.

### Frontend (local)

Hot-reloads on save. Hard-reload (`Cmd+Shift+R`) only when changing hooks or chunks Vite keeps stale.

```bash
cd frontend
npx vite --host 0.0.0.0 --port 4454
```

Browser → `http://localhost:4454`.

### Backend (Spark, 10.110.23.141)

The backend runs at `/home/nvidia/lobster-agents/backend/` on the Spark and listens on `:8001`. After editing backend code locally, deploy + restart:

```bash
# 1. Push source to the Spark
rsync -av --delete backend/src/ nvidia@10.110.23.141:/home/nvidia/lobster-agents/backend/src/

# 2. Restart uvicorn (MUST use `bash -lc` so PATH picks up openshell/nemoclaw)
ssh nvidia@10.110.23.141 '
  pkill -f "uvicorn.*office_agents" 2>/dev/null;
  sleep 2;
  bash -lc "cd /home/nvidia/lobster-agents/backend && \
            nohup ./.venv/bin/python -m uvicorn --app-dir src office_agents.main:app \
              --host 0.0.0.0 --port 8001 > /tmp/office-backend.log 2>&1 & disown"
'

# 3. Confirm everything's green
curl -s http://10.110.23.141:8001/health | jq
# expect: llm reachable, openshell+nemoclaw paths populated, sandboxes.available=true
```

**Important: the `bash -lc` (login shell) is not optional.** A plain `ssh nvidia@spark 'uvicorn ...'` uses a minimal non-interactive PATH; `openshell` and `nemoclaw` live in `~/.local/bin` which only gets added via `.bashrc`. Without login mode the backend boots but the health endpoint reports "Reef is partially down — CLIs not on PATH".

### Backend logs

```bash
ssh nvidia@10.110.23.141 'tail -f /tmp/office-backend.log'
```

### Sanity checks

```bash
# health (all components)
curl -s http://10.110.23.141:8001/health | jq

# is uvicorn actually running?
ssh nvidia@10.110.23.141 'ps aux | grep uvicorn | grep -v grep'

# Ollama up?
curl -s http://10.110.23.141:11434/api/tags | jq '.models[].name'
```

### Quick reef-chat tuning knobs

If lobsters get too chatty or too quiet — `backend/src/office_agents/reef/idle_chat.py`:
- `_ADDRESS_PEER_PROB` — fraction of turns that target a specific lobster (default 0.18; lower = more room-mode).
- `_RECENT_SPEAKERS_BLOCK` — recent speakers excluded from selection (default 2).
- `_THREAD_LENGTH` — avg turns per topic before stochastic rotation (default 6).
- `settings.reef_chat_timeout` (`config.py`) — per-call LLM timeout in seconds, default 180.
- `settings.reef_fallback_on_outage` — when true, emits templated narration on LLM outage instead of going silent.

Convergence thresholds for query mode — `backend/src/office_agents/agents/orchestrator.py` constants: `NARROW_ROSTER_TICK`, `WRITER_DIRECT_TICK`, `WRITER_NUDGE_TICK`, `QUERY_TIMEOUT_TICK`.

---

## Configuration

Copy `.env.example` to `.env` (Docker) or edit `backend/.env` (bare metal):

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_HOST` | `127.0.0.1` | Ollama server IP |
| `LLM_MODEL` | `qwen3.5:35b` | Ollama model name |
| `TAVILY_API_KEY` | (none) | Tavily API key for web search (optional, falls back to DuckDuckGo) |
| `TICK_INTERVAL` | `4.0` | Simulation tick interval in seconds |
| `PORT` | `4454` | Frontend port |
| `HOST_FILES_PATH` | `/home/nvidia/documents` | Directory to mount for agent file access |

---

## Architecture

```
Frontend (React 19 + PixiJS 8 + Tailwind)
    | WebSocket
    v
Backend (FastAPI + Python 3.12)
    | OpenAI-compatible API
    v
Ollama (Qwen 3.5 35B on GPU)
    |
    v
SQLite (agent memory + deliverables)
```

**Frontend** (`frontend/`): React SPA with PixiJS pixel-art canvas, chat panel, whiteboard, activity feed, query history. Served by Nginx in Docker.

**Backend** (`backend/`): FastAPI server with WebSocket for real-time updates. Orchestrates 7 agents in a tick-based simulation loop. Agents run in parallel batches for speed.

**Agents** think via LLM calls and can: move between rooms, speak to each other, search the web, read local files, write code, and write to the whiteboard.

---

## Demo Files

Sample files are included in `demo-files/` for showcasing the private file analysis features:

- `expenses-q1-2025.csv` — 95 personal transactions (groceries, subscriptions, dining, travel)
- `offer-aurora-tech.md` — Job offer from a Series C startup ($205k + RSUs)
- `offer-meridian-ai.md` — Job offer from a Series B AI company ($235k + options)
- `perf-review-notes.md` — Performance review self-assessment with peer feedback
- `water-cooler-topics.md` — Editable list of idle chat topics for agents

---

## Water Cooler Mode

When no query is active, agents pair up in the break room and chat about random topics. Topics are loaded from `demo-files/water-cooler-topics.md` — edit this file to change what they talk about.

**GUI controls** (header "Idle Chat" button):
- Toggle on/off
- Quick topic buttons (Weekend plans, Hot takes, etc.)
- Custom topic input — type anything and agents will discuss it

---

## Project Structure

```
office-agents/
├── backend/
│   ├── src/office_agents/
│   │   ├── agents/          # Agent logic, roles, memory, orchestrator
│   │   ├── office/          # Layout, state, SQLite store
│   │   ├── tools/           # Web search, file reader, code gen
│   │   ├── llm/             # LLM client (OpenAI-compatible)
│   │   ├── main.py          # FastAPI + WebSocket server
│   │   └── config.py        # Settings
│   ├── Dockerfile
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── components/      # React components (canvas, chat, whiteboard, etc.)
│   │   ├── hooks/           # WebSocket + state management
│   │   ├── utils/           # Sprites, sounds, helpers
│   │   └── App.tsx          # Main layout
│   ├── Dockerfile
│   └── nginx.conf
├── docker-compose.yml       # Docker (uses host Ollama)
├── docker-compose.full.yml  # Docker (includes Ollama)
├── start.sh                 # Bare metal start script
└── test_e2e.py              # End-to-end WebSocket test
```
