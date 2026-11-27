"""Сервер для HTTPS reverse proxy с обязательной авторизацией."""
import os
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import app


if __name__ == "__main__":
    origin = os.environ["STP_ORIGIN"]
    parsed = urlsplit(origin)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or origin != "https://"+parsed.netloc:
        raise SystemExit("STP_ORIGIN должен содержать полный HTTPS-адрес без пути.")
    folder = Path(os.environ.get("STP_ACCOUNTS_DIR","/run/secrets"))
    accounts = {}
    for login in ("elizaveta","maria","vlad"):
        name,password = (folder/(login+".txt")).read_text().splitlines()
        if name != login or len(password)<20 or not password.isascii():
            raise SystemExit("Проверьте файл учётной записи "+login)
        accounts[login] = password
    app.ACCOUNTS = accounts
    app.ORIGIN = origin
    app.init()
    ThreadingHTTPServer((os.getenv("STP_BIND","127.0.0.1"),app.PORT),app.Handler).serve_forever()
