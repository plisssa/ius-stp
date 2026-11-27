"""Создаёт личные учётные записи команды и преподавателей.

Запуск из корня проекта: python3 stage2/server/make_users.py
Пишет stage2/team-access/users.json (папка исключена из Git) и печатает одну строку JSON
для секрета STP_USERS в Hugging Face Spaces. Существующие пароли сохраняются.
"""
import json
import secrets
from pathlib import Path

PEOPLE = {
    "elizaveta": "Е. Пузырёва",
    "maria": "М. Корнева",
    "vlad": "В. Веселовский",
    "belov": "А. В. Белов",
    "askolsky": "П. Н. Аскольский",
}
folder = Path(__file__).resolve().parents[1] / "team-access"
folder.mkdir(mode=0o700, exist_ok=True)
path = folder / "users.json"
users = json.loads(path.read_text()) if path.exists() else {}
for login, name in PEOPLE.items():
    users.setdefault(login, {"password": secrets.token_urlsafe(15), "name": name,
                             "roles": ["client", "engineer", "head"], "org": "ORG-A"})
path.write_text(json.dumps(users, ensure_ascii=False, indent=1))
path.chmod(0o600)
print("Файл:", path)
print("Логины и пароли — передайте каждому только его строку:")
for login, info in users.items():
    print(f"  {info['name']}: {login} / {info['password']}")
print("\nЗначение секрета STP_USERS (одной строкой):")
print(json.dumps(users, ensure_ascii=False, separators=(",", ":")))
