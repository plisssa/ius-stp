"""Интеграционная проверка общего сервера: личные входы, сервер инструментов по Unix-сокету и настоящая Ollama."""
import http.client
import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://stp.example.org"


def request(port, cookie, route, payload=None):
    headers = {"Host": "stp.example.org"}
    if cookie:
        headers["Cookie"] = cookie
    if payload is not None:
        headers.update({"Origin": ORIGIN, "Content-Type": "application/json"})
    client = http.client.HTTPConnection("127.0.0.1", port, timeout=65)
    try:
        client.request("POST" if payload is not None else "GET", route, json.dumps(payload) if payload is not None else None, headers)
        response = client.getresponse()
        body = json.loads(response.read())
        set_cookie = response.getheader("Set-Cookie") or ""
        return response.status, body, set_cookie.split(";")[0]
    finally:
        client.close()


def start_app(env):
    process = subprocess.Popen([sys.executable, str(ROOT / "server/team_app.py")], env=env)
    for _ in range(200):
        if process.poll() is not None:
            raise RuntimeError("Сервер завершился при запуске")
        try:
            with socket.create_connection(("127.0.0.1", int(env["STP_PORT"])), timeout=.2):
                return process
        except OSError:
            time.sleep(.05)
    process.terminate()
    raise TimeoutError("Сервер не запустился")


def check():
    with tempfile.TemporaryDirectory(dir="/tmp") as tmp, socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        users = {name: {"password": secrets.token_urlsafe(16), "name": name.capitalize(), "roles": ["client", "engineer", "head"]} for name in ("elizaveta", "maria", "vlad")}
        env = {**os.environ, "PYTHONPATH": str(ROOT), "STP_USERS": json.dumps(users), "STP_ORIGIN": ORIGIN, "STP_QUIET": "1",
               "STP_BIND": "127.0.0.1", "STP_PORT": str(port), "STP_DB": tmp + "/team.sqlite", "STP_MCP_SOCKET": tmp + "/tools.sock"}
        tools = subprocess.Popen([sys.executable, str(ROOT / "server/mcp_service.py")], env=env)
        app = None
        try:
            app = start_app(env)
            for _ in range(100):
                if Path(env["STP_MCP_SOCKET"]).is_socket():
                    break
                time.sleep(.05)
            cookie = {}
            for name in users:
                status, _, cookie[name] = request(port, None, "/api/login", {"login": name, "password": users[name]["password"]})
                assert status == 200
            status, result, _ = request(port, cookie["vlad"], "/api/tickets/ES-9101/suggest", {})
            assert status == 200 and "готов" in result["message"], result
            proposal = next(p for p in request(port, cookie["maria"], "/api/tickets/ES-9101")[1]["proposals"] if p["kind"] == "A4")
            body = {"action": "Принять", "proposal": proposal["id"]}
            assert request(port, cookie["maria"], "/api/tickets/ES-9101/decision", body)[0] == 200
            assert request(port, cookie["vlad"], "/api/tickets/ES-9101/decision", body)[0] == 400
            assert request(port, cookie["elizaveta"], "/api/tickets/ES-9101")[1]["answer"] == proposal["draft"]
            app.terminate()
            app.wait()
            app = start_app(env)
            status, _, again = request(port, None, "/api/login", {"login": "vlad", "password": users["vlad"]["password"]})
            saved = request(port, again, "/api/tickets/ES-9101")[1]
            assert saved["answer"] == proposal["draft"] and saved["assignee"] == "Maria" and saved["status"] == "Waiting for customer"
            assert any(e["actor"] == "Maria" for e in saved["log"])
            print("OK: Влад запросил черновик, Мария приняла, Елизавета увидела ответ. Повтор заблокирован. Ответ и исполнитель сохранены после перезапуска.")
        finally:
            for child in (app, tools):
                if child is not None:
                    child.terminate()
                    child.wait()


if __name__ == "__main__":
    check()
