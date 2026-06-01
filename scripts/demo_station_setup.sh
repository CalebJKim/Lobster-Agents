#!/usr/bin/env bash
set -euo pipefail

# Prepare a vLLM-backed NemoClaw/OpenShell demo station.
# Run this after vLLM is serving on VLLM_PORT and before starting the reef app.

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage:
  scripts/demo_station_setup.sh

Environment overrides:
  VLLM_PORT=8000
  VLLM_SERVED_MODEL_NAME=qwen3.6-27b-fp8
  NEMOCLAW_SANDBOXES="nemoclaw-clawdia-reef nemoclaw-captain-bridge nemoclaw-pearl-script nemoclaw-snips-workbench"
  DRY_RUN=1

This script:
  1. Verifies vLLM is reachable on localhost.
  2. Points OpenShell's compatible-endpoint provider at host.openshell.internal.
  3. Creates the starter NemoClaw sandboxes if missing.
  4. Syncs every starter sandbox to the vLLM-served model.
EOF
  exit 0
fi

export PATH="$HOME/.local/bin:$PATH"

VLLM_PORT="${VLLM_PORT:-8000}"
MODEL_NAME="${VLLM_SERVED_MODEL_NAME:-qwen3.6-27b-fp8}"
DRY_RUN="${DRY_RUN:-0}"
SANDBOXES_TEXT="${NEMOCLAW_SANDBOXES:-nemoclaw-clawdia-reef nemoclaw-captain-bridge nemoclaw-pearl-script nemoclaw-snips-workbench}"
read -r -a SANDBOXES <<<"$SANDBOXES_TEXT"

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'DRY RUN:'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 2
  fi
}

require_cmd curl
require_cmd openshell
require_cmd nemoclaw
require_cmd python3

if [[ "$DRY_RUN" != "1" ]]; then
  curl -fsS "http://127.0.0.1:${VLLM_PORT}/v1/models" >/dev/null
fi

run openshell provider update compatible-endpoint \
  --config "OPENAI_BASE_URL=http://host.openshell.internal:${VLLM_PORT}/v1"

status_file="$(mktemp)"
trap 'rm -f "$status_file"' EXIT

if [[ "$DRY_RUN" == "1" ]]; then
  printf '{"sandboxes":[]}\n' >"$status_file"
elif ! nemoclaw status --json >"$status_file"; then
  printf '{"sandboxes":[]}\n' >"$status_file"
fi

sandbox_exists() {
  python3 - "$status_file" "$1" <<'PY'
import json
import sys

path, wanted = sys.argv[1], sys.argv[2]
try:
    data = json.load(open(path))
except Exception:
    data = {}
for sandbox in data.get("sandboxes", []):
    if sandbox.get("name") == wanted:
        raise SystemExit(0)
raise SystemExit(1)
PY
}

for sandbox in "${SANDBOXES[@]}"; do
  if sandbox_exists "$sandbox"; then
    echo "Sandbox exists: $sandbox"
  else
    run nemoclaw onboard \
      --non-interactive \
      --yes \
      --yes-i-accept-third-party-software \
      --name "$sandbox" \
      --no-gpu \
      --no-sandbox-gpu
  fi

  run nemoclaw inference set \
    --provider compatible-endpoint \
    --model "$MODEL_NAME" \
    --sandbox "$sandbox" \
    --no-verify
done

if [[ "$DRY_RUN" != "1" ]]; then
  nemoclaw status --json
fi
