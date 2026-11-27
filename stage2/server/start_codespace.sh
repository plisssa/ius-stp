#!/usr/bin/env bash
# Запуск общего сервиса в GitHub Codespaces. Из корня репозитория: bash stage2/server/start_codespace.sh
set -eu
: "${CODESPACE_NAME:?Запустите команду в терминале Codespace}"
: "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:?Нет домена переадресации портов Codespaces}"
cd "$(dirname "$0")/.."
export STP_DOMAIN="${CODESPACE_NAME}-8765.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
python3 server/make_users.py | sed '/^Значение секрета/,$d'
sudo chgrp 10001 team-access/users.json
chmod 640 team-access/users.json
sudo install -d -o 10001 -g 10001 -m 700 team-access/state
compose=(docker compose -f compose.yaml -f server/compose.codespaces.yaml)
"${compose[@]}" up -d --build app tools ollama
for attempt in {1..60}; do
    if "${compose[@]}" exec -T ollama ollama list >/dev/null 2>&1; then break; fi
    sleep 2
done
"${compose[@]}" exec -T ollama ollama pull qwen2.5:0.5b
"${compose[@]}" restart app >/dev/null  # перечитать учётные записи
for attempt in {1..60}; do
    if curl -s -o /dev/null -H "Host: $STP_DOMAIN" http://127.0.0.1:8765/; then break; fi
    sleep 2
done
if ! gh codespace ports visibility 8765:public -c "$CODESPACE_NAME" >/dev/null 2>&1; then
    echo "Сделайте порт публичным вручную: панель PORTS → строка 8765 → правый клик → Port Visibility → Public"
fi
printf '\nСервис: https://%s\n' "$STP_DOMAIN"
echo "Остановка после показа: Codespaces → Stop codespace (данные сохраняются в team-access/state)."
