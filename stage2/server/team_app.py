"""Общий сервер: личные учётные записи, HTTPS-адрес, контроль SLA и инструменты через Unix-сокет.

Учётные записи (по приоритету):
  STP_USERS       — JSON в переменной окружения (секрет Hugging Face Spaces);
  STP_USERS_FILE  — путь к JSON-файлу (team-access/users.json от make_users.py);
  STP_ACCOUNTS_DIR — каталог с файлами login.txt (логин и пароль в двух строках).
"""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import app


def accounts():
    if os.getenv("STP_USERS"):
        return json.loads(os.environ["STP_USERS"])
    if os.getenv("STP_USERS_FILE"):
        return json.loads(Path(os.environ["STP_USERS_FILE"]).read_text())
    folder = Path(os.environ.get("STP_ACCOUNTS_DIR", "/run/secrets"))
    spec = {}
    for f in sorted(folder.glob("*.txt")):
        login, password = f.read_text().splitlines()[:2]
        spec[login] = password
    return spec


if __name__ == "__main__":
    origin = os.getenv("STP_ORIGIN") or ("https://" + os.environ["SPACE_HOST"] if os.getenv("SPACE_HOST") else "")
    parsed = urlsplit(origin)
    if parsed.scheme != "https" or not parsed.hostname or origin != "https://" + parsed.netloc:
        raise SystemExit("Задайте STP_ORIGIN — полный HTTPS-адрес без пути (на Hugging Face берётся из SPACE_HOST).")
    spec = accounts()
    if not spec:
        raise SystemExit("Нет учётных записей: задайте секрет STP_USERS (см. server/make_users.py).")
    app.ACCOUNTS = app.load_accounts(spec)
    app.ORIGIN = origin
    app.PORT = int(os.getenv("STP_PORT", "8765"))
    app.serve(os.getenv("STP_BIND", "127.0.0.1"))
