#!/usr/bin/env bash
set -euo pipefail

# Launch an OpenAI-compatible vLLM server for Lobster Agents on a GB300 demo
# host. Defaults target the large GB300 GPU when the host also has a smaller
# display GPU. Override via env vars instead of editing this file.

MODEL="${VLLM_MODEL:-sakamakismile/Qwen3.6-27B-Text-NVFP4-MTP}"
SERVED_MODEL_NAME="${VLLM_SERVED_MODEL_NAME:-qwen3.6-27b-mtp}"
HOST="${VLLM_HOST:-0.0.0.0}"
PORT="${VLLM_PORT:-8000}"
VENV="${VLLM_VENV:-$HOME/vllm-venv}"
LOG_FILE="${VLLM_LOG_FILE:-/tmp/lobster-vllm.log}"
PID_FILE="${VLLM_PID_FILE:-/tmp/lobster-vllm.pid}"
CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-1}"
TENSOR_PARALLEL_SIZE="${VLLM_TENSOR_PARALLEL_SIZE:-1}"
GPU_MEMORY_UTILIZATION="${VLLM_GPU_MEMORY_UTILIZATION:-0.86}"
MAX_MODEL_LEN="${VLLM_MAX_MODEL_LEN:-32768}"
STARTUP_TIMEOUT_SECONDS="${VLLM_STARTUP_TIMEOUT_SECONDS:-900}"
INSTALL_IF_MISSING="${VLLM_INSTALL_IF_MISSING:-0}"
RESTART="${VLLM_RESTART:-0}"
EXTRA_ARGS="${VLLM_EXTRA_ARGS:-}"

if [[ ! -d "$VENV" ]]; then
  python3 -m venv "$VENV"
fi

# shellcheck source=/dev/null
source "$VENV/bin/activate"

if ! python - <<'PY' >/dev/null 2>&1
import importlib.util
raise SystemExit(0 if importlib.util.find_spec("vllm") else 1)
PY
then
  if [[ "$INSTALL_IF_MISSING" == "1" ]]; then
    python -m pip install --upgrade pip
    python -m pip install --upgrade vllm
  else
    cat >&2 <<EOF
vLLM is not installed in $VENV.

Install it explicitly, then rerun:
  VLLM_INSTALL_IF_MISSING=1 $0

or install manually:
  source "$VENV/bin/activate"
  python -m pip install --upgrade vllm
EOF
    exit 2
  fi
fi

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${existing_pid:-}" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    if [[ "$RESTART" == "1" ]]; then
      kill "$existing_pid"
      for _ in {1..30}; do
        kill -0 "$existing_pid" 2>/dev/null || break
        sleep 1
      done
    else
      echo "vLLM already appears to be running from $PID_FILE as pid $existing_pid."
      echo "Set VLLM_RESTART=1 to stop that pid and relaunch."
      exit 0
    fi
  fi
fi

if curl -fsS "http://127.0.0.1:${PORT}/v1/models" >/dev/null 2>&1; then
  echo "A vLLM/OpenAI-compatible server is already responding on 127.0.0.1:${PORT}."
  echo "Leaving it untouched. Set VLLM_PORT to use a different port."
  exit 0
fi

mkdir -p "$(dirname "$LOG_FILE")"
echo "Starting vLLM:"
echo "  model:              $MODEL"
echo "  served model name:  $SERVED_MODEL_NAME"
echo "  endpoint:           http://${HOST}:${PORT}/v1"
echo "  CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"
echo "  log:                $LOG_FILE"

# Intentionally use python -m so the selected venv controls the vLLM version.
# EXTRA_ARGS is deliberately split by the shell to support vLLM flags such as:
#   VLLM_EXTRA_ARGS="--enable-prefix-caching --max-num-seqs 8"
CUDA_VISIBLE_DEVICES="$CUDA_VISIBLE_DEVICES" \
nohup python -m vllm.entrypoints.openai.api_server \
  --host "$HOST" \
  --port "$PORT" \
  --model "$MODEL" \
  --served-model-name "$SERVED_MODEL_NAME" \
  --trust-remote-code \
  --tensor-parallel-size "$TENSOR_PARALLEL_SIZE" \
  --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" \
  --max-model-len "$MAX_MODEL_LEN" \
  $EXTRA_ARGS \
  >"$LOG_FILE" 2>&1 &

pid="$!"
echo "$pid" > "$PID_FILE"
echo "vLLM pid: $pid"

deadline=$((SECONDS + STARTUP_TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  if curl -fsS "http://127.0.0.1:${PORT}/v1/models" >/dev/null 2>&1; then
    echo "vLLM is ready: http://127.0.0.1:${PORT}/v1"
    curl -fsS "http://127.0.0.1:${PORT}/v1/models" || true
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "vLLM process exited before readiness. Last log lines:" >&2
    tail -80 "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 5
done

echo "Timed out waiting for vLLM readiness after ${STARTUP_TIMEOUT_SECONDS}s." >&2
echo "Last log lines:" >&2
tail -80 "$LOG_FILE" >&2 || true
exit 1
