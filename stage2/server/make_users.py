"""Учётные записи общего сервиса.

По умолчанию — одна запись admin / admin со всеми ролями (клиент, инженер, руководитель).
С флагом --team — личные записи команды и преподавателей со случайными паролями.

Запуск из корня проекта: python3 stage2/server/make_users.py [--team]
Пишет stage2/team-access/users.json (папка исключена из Git) и печатает строку для секрета STP_USERS.
"""
import json
import secrets
import sys
from pathlib import Path

ROLES = ["client", "engineer", "head"]
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
if "--team" in sys.argv:
    users = json.loads(path.read_text()) if path.exists() else {}
    users.pop("admin", None)
    for login, name in PEOPLE.items():
        users.setdefault(login, {"password": secrets.token_urlsafe(15), "name": name, "roles": ROLES, "org": "ORG-A"})
else:
    users = {"admin": {"password": "admin", "name": "Администратор", "roles": ROLES, "org": "ORG-A"}}
path.write_text(json.dumps(users, ensure_ascii=False, indent=1))
path.chmod(0o600)
print("Файл:", path)
print("Логины и пароли:")
for login, info in users.items():
    print(f"  {info['name']}: {login} / {info['password']}")
print("\nЗначение секрета STP_USERS (одной строкой):")
print(json.dumps(users, ensure_ascii=False, separators=(",", ":")))
