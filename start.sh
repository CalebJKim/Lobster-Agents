#!/bin/bash
set -e

echo '=== Office Agents - Starting Full Stack ==='

# 1. Start Ollama
echo '[1/3] Starting Ollama...'
pkill ollama 2>/dev/null || true
sleep 1
OLLAMA_HOST=0.0.0.0 nohup ollama serve > /tmp/ollama.log 2>&1 &
sleep 3

# Pull model if needed
ollama list | grep -q 'qwen3.5:35b' || ollama pull qwen3.5:35b

# Warm the model
echo '  Warming model on GPU...'
curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3.5:35b","messages":[{"role":"user","content":"hi"}],"max_tokens":8}' > /dev/null 2>&1
echo '  Ollama ready!'

# 2. Start backend
echo '[2/3] Starting backend...'
fuser -k 8001/tcp 2>/dev/null || true
sleep 1
cd /home/nvidia/office-agents/backend
source .venv/bin/activate
nohup uvicorn office_agents.main:app --host 0.0.0.0 --port 8001 > /tmp/office-backend.log 2>&1 &
echo "  Backend PID: $!"
sleep 3

# 3. Start frontend
echo '[3/3] Starting frontend...'
fuser -k 4454/tcp 2>/dev/null || true
sleep 1
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 2>/dev/null || true
cd /home/nvidia/office-agents/frontend
nohup npx vite --host 0.0.0.0 --port 4454 > /tmp/office-frontend.log 2>&1 &
echo "  Frontend PID: $!"
sleep 3

# Status
IP=$(hostname -I | awk '{print $1}')
echo ''
echo '=== All services started ==='
echo "  LLM:      http://${IP}:11434  (Qwen 3.5 35B on GPU)"
echo "  Backend:  http://${IP}:8001"
echo "  Frontend: http://${IP}:4454   <-- open this"
echo ''
echo 'Logs:'
echo '  tail -f /tmp/ollama.log'
echo '  tail -f /tmp/office-backend.log'
echo '  tail -f /tmp/office-frontend.log'
