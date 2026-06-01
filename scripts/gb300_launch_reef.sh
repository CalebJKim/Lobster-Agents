#!/usr/bin/env bash
set -euo pipefail

# Launch the Lobster Agents backend and frontend on a GB300 demo host.
# This assumes vLLM is already serving an OpenAI-compatible API on VLLM_PORT.

ROOT_DIR="${LOBSTER_REEF_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKEND_PORT="${BACKEND_PORT:-8001}"
FRONTEND_PORT="${FRONTEND_PORT:-4454}"
VLLM_PORT="${VLLM_PORT:-8000}"
MODEL_NAME="${OFFICE_AGENTS_LLM_MODEL:-qwen3.6-27b-fp8}"
MAX_WORKERS="${OFFICE_AGENTS_SANDBOX_MAX_CONCURRENT_OPENCLAW_RUNS:-2}"
BACKEND_LOG="${BACKEND_LOG:-/tmp/lobster-backend.log}"
FRONTEND_LOG="${FRONTEND_LOG:-/tmp/lobster-frontend.log}"
BACKEND_PID_FILE="${BACKEND_PID_FILE:-/tmp/lobster-backend.pid}"
FRONTEND_PID_FILE="${FRONTEND_PID_FILE:-/tmp/lobster-frontend.pid}"

wait_for_url() {
  local url="$1"
  local timeout="${2:-60}"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

ensure_backend_env() {
  cd "$ROOT_DIR/backend"
  if [[ ! -x .venv/bin/python ]]; then
    python3 -m venv .venv
  fi
  if ! .venv/bin/python -m pip --version >/dev/null 2>&1; then
    .venv/bin/python -m ensurepip --upgrade
  fi
  # shellcheck source=/dev/null
  source .venv/bin/activate
  python -m pip install -e .
}

ensure_frontend_env() {
  cd "$ROOT_DIR/frontend"
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "$HOME/.nvm/nvm.sh"
  fi
  if [[ ! -d node_modules ]]; then
    npm install
  fi
}

if ! curl -fsS "http://127.0.0.1:${VLLM_PORT}/v1/models" >/dev/null 2>&1; then
  cat >&2 <<EOF
vLLM is not responding at http://127.0.0.1:${VLLM_PORT}/v1/models.
Start it first:
  scripts/gb300_launch_vllm.sh
EOF
  exit 2
fi

ensure_backend_env

if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
  echo "Backend already responding on :${BACKEND_PORT}; leaving it untouched."
else
  cd "$ROOT_DIR/backend"
  # shellcheck source=/dev/null
  source .venv/bin/activate
  mkdir -p "$(dirname "$BACKEND_LOG")"
  PATH="$HOME/.local/bin:$PATH" \
  OFFICE_AGENTS_LLM_BASE_URL="${OFFICE_AGENTS_LLM_BASE_URL:-http://127.0.0.1:${VLLM_PORT}/v1}" \
  OFFICE_AGENTS_LLM_MODEL="$MODEL_NAME" \
  OFFICE_AGENTS_LLM_API_KEY="${OFFICE_AGENTS_LLM_API_KEY:-dummy}" \
  OFFICE_AGENTS_NEMOCLAW_PROVIDER="${OFFICE_AGENTS_NEMOCLAW_PROVIDER:-custom}" \
  OFFICE_AGENTS_NEMOCLAW_ENDPOINT_URL="${OFFICE_AGENTS_NEMOCLAW_ENDPOINT_URL:-http://host.openshell.internal:${VLLM_PORT}/v1}" \
  OFFICE_AGENTS_NEMOCLAW_MODEL="${OFFICE_AGENTS_NEMOCLAW_MODEL:-$MODEL_NAME}" \
  OFFICE_AGENTS_NEMOCLAW_API_KEY="${OFFICE_AGENTS_NEMOCLAW_API_KEY:-dummy}" \
  OFFICE_AGENTS_SANDBOX_MAX_CONCURRENT_OPENCLAW_RUNS="$MAX_WORKERS" \
  nohup python -m uvicorn --app-dir src office_agents.main:app \
    --host 0.0.0.0 \
    --port "$BACKEND_PORT" \
    >"$BACKEND_LOG" 2>&1 &
  echo "$!" > "$BACKEND_PID_FILE"
  wait_for_url "http://127.0.0.1:${BACKEND_PORT}/health" 90 || {
    echo "Backend did not become healthy. Last log lines:" >&2
    tail -80 "$BACKEND_LOG" >&2 || true
    exit 1
  }
  echo "Backend ready: http://127.0.0.1:${BACKEND_PORT}"
fi

ensure_frontend_env

if curl -fsS "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null 2>&1; then
  echo "Frontend already responding on :${FRONTEND_PORT}; leaving it untouched."
else
  cd "$ROOT_DIR/frontend"
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "$HOME/.nvm/nvm.sh"
  fi
  mkdir -p "$(dirname "$FRONTEND_LOG")"
  VITE_BACKEND="${VITE_BACKEND:-http://127.0.0.1:${BACKEND_PORT}}" \
  nohup npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" \
    >"$FRONTEND_LOG" 2>&1 &
  echo "$!" > "$FRONTEND_PID_FILE"
  wait_for_url "http://127.0.0.1:${FRONTEND_PORT}" 90 || {
    echo "Frontend did not become ready. Last log lines:" >&2
    tail -80 "$FRONTEND_LOG" >&2 || true
    exit 1
  }
  echo "Frontend ready: http://127.0.0.1:${FRONTEND_PORT}"
fi

echo
echo "GB300 reef is up:"
echo "  vLLM:     http://127.0.0.1:${VLLM_PORT}/v1"
echo "  Backend:  http://127.0.0.1:${BACKEND_PORT}"
echo "  Frontend: http://127.0.0.1:${FRONTEND_PORT}"
