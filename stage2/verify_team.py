"""Проверка двух участников и общего состояния через HTTP на временном порту."""
import base64
import http.client
import json
import tempfile
import threading
from pathlib import Path
from http.server import ThreadingHTTPServer
import app

with tempfile.TemporaryDirectory() as directory, ThreadingHTTPServer(("127.0.0.1",0),app.Handler) as server:
    app.DB = str(Path(directory)/"team.sqlite")
    app.ACCOUNTS = {"engineer1":"test-one","engineer2":"test-two"}
    app.ORIGIN = f"http://127.0.0.1:{server.server_port}"
    app.init()
    threading.Thread(target=server.serve_forever,daemon=True).start()

    def request(user,path,body=None,origin=None):
        headers = {}
        if user:
            credentials = f"{user}:{app.ACCOUNTS[user]}".encode()
            headers["Authorization"] = "Basic "+base64.b64encode(credentials).decode()
        if body:
            headers.update({"Origin":origin or app.ORIGIN,"Content-Type":"application/json"})
        conn = http.client.HTTPConnection("127.0.0.1",server.server_port,timeout=4)
        conn.request("POST" if body else "GET",path,json.dumps(body) if body else None,headers)
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        return response.status,json.loads(raw) if raw else None

    for path in ("/","/state","/session"):
        assert request(None,path)[0] == 401
    assert request("engineer1","/session")[1]["actor"] == "engineer1"
    body = {"id":"ES-6001","action":"Вручную","text":"Учебный ответ"}
    assert request("engineer1","/decision",body,"https://example.invalid")[0]==403
    assert request("engineer1","/decision",body)[0]==200
    rows = request("engineer2","/state")[1]
    ticket = next(t for t in rows if t["id"]==body["id"])
    assert ticket["answer"] == body["text"] and ticket["log"][0]["actor"]=="engineer1"
    assert ticket["assignee"] == "engineer1" and ticket["status"] == "Waiting for customer"
    assert request("engineer2","/decision",body)[0]==400
    assert len(rows)==242 and all(t["org"]=="ORG-A" for t in rows)
    server.shutdown()
print("Две учётные записи: вход, общая очередь, автор ответа, защита от повторного решения и проверка Origin — OK")
