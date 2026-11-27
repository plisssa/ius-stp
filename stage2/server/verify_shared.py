"""Интеграционная проверка с настоящей Ollama; данные хранятся во временной папке."""
import base64
import http.client
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://stp.example.org"


def request(port, users, login, route, payload=None):
    credentials = base64.b64encode(f"{login}:{users[login]}".encode()).decode()
    headers = {"Host": "stp.example.org", "Authorization": "Basic "+credentials}
    if payload is not None:
        headers.update({"Origin": ORIGIN, "Content-Type": "application/json"})
    client = http.client.HTTPConnection("127.0.0.1", port, timeout=65)
    try:
        client.request("POST" if payload else "GET", route, json.dumps(payload) if payload else None, headers)
        response = client.getresponse()
        return response.status, json.loads(response.read())
    finally:
        client.close()


def start_app(env):
    process = subprocess.Popen([sys.executable,str(ROOT/"server/team_app.py")],env=env)
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError("Сервер завершился при запуске")
            try:
                with socket.create_connection(("127.0.0.1",int(env["STP_PORT"])),timeout=.2):
                    return process
            except OSError:
                time.sleep(.05)
        raise TimeoutError("Сервер не запустился")
    except BaseException:
        process.terminate()
        process.wait()
        raise


def check():
    with tempfile.TemporaryDirectory(dir="/tmp") as tmp, socket.socket() as probe:
        probe.bind(("127.0.0.1",0))
        port = probe.getsockname()[1]
        probe.close()
        users = {name:secrets.token_urlsafe(24) for name in ("elizaveta","maria","vlad")}
        for name,password in users.items():
            (Path(tmp)/(name+".txt")).write_text(name+"\n"+password+"\n")
        env = {**os.environ,"PYTHONPATH":str(ROOT),"STP_ACCOUNTS_DIR":tmp,"STP_ORIGIN":ORIGIN,
               "STP_BIND":"127.0.0.1","STP_PORT":str(port),"STP_DB":tmp+"/team.sqlite","STP_MCP_SOCKET":tmp+"/tools.sock"}
        tools = subprocess.Popen([sys.executable,str(ROOT/"server/mcp_service.py")],env=env)
        app = None
        try:
            app = start_app(env)
            for _ in range(100):
                if Path(env["STP_MCP_SOCKET"]).is_socket():
                    break
                time.sleep(.05)
            def ticket(user):
                status,rows = request(port,users,user,"/state")
                assert status == 200
                return next(t for t in rows if t["id"]=="ES-9101")
            status,result = request(port,users,"vlad","/suggest",{"id":"ES-9101"})
            assert status == 200 and "готов" in result["message"],result
            proposal = ticket("maria")["proposals"][0]
            body = {"id":"ES-9101","action":"Принять","proposal":proposal["id"]}
            assert request(port,users,"maria","/decision",body)[0] == 200
            assert request(port,users,"vlad","/decision",body)[0] == 400
            assert ticket("elizaveta")["answer"] == proposal["draft"]
            app.terminate()
            app.wait()
            app = start_app(env)
            saved = ticket("vlad")
            assert saved["answer"] == proposal["draft"] and saved["log"][0]["actor"]=="maria"
            assert saved["assignee"] == "maria" and saved["status"] == "Waiting for customer"
            print("OK: Влад запросил модель, Мария приняла, Елизавета увидела ответ. Повтор заблокирован. Ответ и автор решения сохранены после перезапуска.")
        finally:
            for child in (app,tools):
                if child is not None:
                    child.terminate()
                    child.wait()


if __name__ == "__main__":
    check()
