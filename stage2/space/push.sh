#!/usr/bin/env bash
# Отправляет сервис в Hugging Face Space. Запуск из корня проекта:
#   bash stage2/space/push.sh ВАШ_ЛОГИН_HF/ius-stp
# Git спросит логин Hugging Face и токен с правом записи (вводите сами, токен нигде не сохраняется скриптом).
set -eu
SPACE="${1:?Укажите Space в виде логин/имя}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
cp -R "$SRC/app.py" "$SRC/classifier.py" "$SRC/mcp_stdio.py" "$SRC/data.json" "$SRC/sla.json" "$SRC/tools.json" "$SRC/web" "$TMP/"
mkdir -p "$TMP/server" "$TMP/ml"
cp "$SRC/server/team_app.py" "$SRC/server/mcp_service.py" "$TMP/server/"
cp "$SRC/ml/model.json" "$SRC/ml/metrics.json" "$TMP/ml/"
cp "$SRC/space/Dockerfile" "$SRC/space/start.sh" "$SRC/space/README.md" "$TMP/"
cd "$TMP"
git init -q -b main
git add .
git -c user.name="$(git -C "$SRC" config user.name)" -c user.email="$(git -C "$SRC" config user.email)" commit -qm "ИУС СТП: учебный сервис этапа 2"
git push --force "https://huggingface.co/spaces/$SPACE" main
echo "Готово: https://huggingface.co/spaces/$SPACE (сборка займёт несколько минут)"
