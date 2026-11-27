#!/usr/bin/env bash
# Запуск в Hugging Face Spaces: модель и сервер инструментов слушают только внутри контейнера.
set -eu
mkdir -p /tmp/stp
export STP_DB="${STP_DB:-/tmp/stp/stp.sqlite}"
if [ -d /data ] && [ -w /data ]; then export STP_DB=/data/stp.sqlite; fi  # постоянное хранилище, если подключено
export STP_MCP_SOCKET=/tmp/stp/tools.sock STP_PORT=7860 STP_BIND=0.0.0.0 STP_QUIET=1
ollama serve >/tmp/stp/ollama.log 2>&1 &
python3 server/mcp_service.py &
for i in $(seq 1 60); do ollama list >/dev/null 2>&1 && break; sleep 1; done
# Прогрев: первая генерация загружает модель в память.
python3 - <<'PY' || true
import json, os, urllib.request
req = urllib.request.Request("http://127.0.0.1:11434/api/generate", json.dumps({"model": os.environ["STP_MODEL"], "prompt": "ok", "stream": False, "options": {"num_predict": 1}}).encode(), {"Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=120).read()
PY
exec python3 server/team_app.py
