#!/usr/bin/env bash
set -eu
: "${CODESPACE_NAME:?Run this command inside the team codespace}"
: "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:?Missing forwarding domain}"
cd "$(dirname "$0")/.."
export STP_DOMAIN="${CODESPACE_NAME}-8765.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
python3 -c 'from share import credentials; credentials()'
sudo chgrp 10001 team-access/{elizaveta,maria,vlad}.txt
chmod 640 team-access/{elizaveta,maria,vlad}.txt
sudo install -d -o 10001 -g 10001 -m 700 team-access/state
compose=(docker compose -f compose.yaml -f server/compose.codespaces.yaml)
"${compose[@]}" up -d --build app tools ollama
for attempt in {1..30}; do
    if "${compose[@]}" exec -T ollama ollama list >/dev/null 2>&1; then break; fi
    sleep 2
done
"${compose[@]}" exec -T ollama ollama pull qwen2.5:0.5b
printf 'Рабочее место: https://%s\n' "$STP_DOMAIN"
