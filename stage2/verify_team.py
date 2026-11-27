"""Проверка HTTP-интерфейса с личными входами: сессии, роли, портал, разграничение, отчёты, Origin и Host."""
import http.client
import json
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

import app

USERS = {"engineer1": {"password": "test-password-one", "name": "Инженер Один", "roles": ["engineer", "head"]},
         "client1": {"password": "test-password-two", "name": "Клиент Один", "roles": ["client"], "org": "ORG-A"},
         "client2": {"password": "test-password-three", "name": "Клиент Два", "roles": ["client"], "org": "ORG-B"}}

with tempfile.TemporaryDirectory() as directory, ThreadingHTTPServer(("127.0.0.1", 0), app.Handler) as server:
    app.DB = str(Path(directory) / "team.sqlite")
    app.ACCOUNTS = app.load_accounts(USERS)
    app.ORIGIN = f"http://127.0.0.1:{server.server_port}"
    app.init()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    cookies = {}

    def request(user, path, body=None, origin=None, host=None):
        headers = {"Host": host or app.ORIGIN.split("://")[1]}
        if user in cookies:
            headers["Cookie"] = cookies[user]
        if body is not None:
            headers.update({"Origin": origin or app.ORIGIN, "Content-Type": "application/json"})
        conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=10)
        conn.request("POST" if body is not None else "GET", path, json.dumps(body) if body is not None else None, headers)
        response = conn.getresponse()
        raw = response.read()
        set_cookie = response.getheader("Set-Cookie")
        conn.close()
        if set_cookie and set_cookie.startswith("stp_session=") and user:
            cookies[user] = set_cookie.split(";")[0]
            if "Max-Age=0" in set_cookie:
                cookies.pop(user)
        return response.status, json.loads(raw) if raw and raw[:1] in b"[{" else raw

    def login(user):
        status, _ = request(user, "/api/login", {"login": user, "password": USERS[user]["password"]})
        assert status == 200, status

    assert request(None, "/api/session")[0] == 401 and request(None, "/api/tickets")[0] == 401
    assert request(None, "/")[0] == 200
    assert request("client1", "/api/login", {"login": "client1", "password": "неверный"})[0] == 401
    for user in USERS:
        login(user)
    assert request("client1", "/api/session")[1]["name"] == "Клиент Один"
    assert request("client1", "/api/login", {"login": "client1", "password": USERS["client1"]["password"]}, origin="https://evil.example")[0] == 403
    assert request("engineer1", "/api/session", host="evil.example")[0] == 403
    print("Вход: без сессии 401, неверный пароль 401, чужой Origin и Host отклонены")

    new = {"title": "Не сохраняется отчёт", "body": "При экспорте отчёта за ноябрь файл пустой.", "topic": "Экспорт", "type": "Ошибка", "priority": "P2"}
    status, created = request("client1", "/api/tickets", new)
    assert status == 200, created
    tid = created["id"]
    assert request("engineer1", "/api/tickets", new)[0] == 404  # у инженера нет роли клиента
    assert request("client1", "/api/tickets")[0] == 403  # клиенту недоступна очередь инженера
    assert [t["id"] for t in request("client1", "/api/tickets?view=client")[1]] == [tid]
    assert request("client2", "/api/tickets?view=client")[1] == []
    assert request("client2", f"/api/tickets/{tid}?view=client")[0] == 404
    detail = request("client1", f"/api/tickets/{tid}?view=client")[1]
    assert "log" not in detail and "proposals" not in detail
    print("Портал: заявка создана, клиент другой организации её не видит, журнал и предложения ИИ клиенту не отдаются")

    status, body = request("engineer1", f"/api/tickets/{tid}/decision", {"action": "Вручную", "text": "Уточните фильтры выгрузки."})
    assert status == 200, body
    ticket = request("engineer1", f"/api/tickets/{tid}")[1]
    assert ticket["assignee"] == "Инженер Один" and ticket["status"] == "Waiting for customer" and ticket["log"][0]["actor"] == "Инженер Один"
    assert request("engineer1", f"/api/tickets/{tid}/decision", {"action": "Вручную", "text": "Повтор"})[0] == 400
    assert request("client1", f"/api/tickets/{tid}/client", {"action": "Помогло"})[0] == 200
    assert request("client1", f"/api/tickets/{tid}?view=client")[1]["status"] == "Closed"
    print("Решение: первый ответ назначил исполнителя, повтор отклонён, клиент закрыл заявку оценкой «помогло»")

    kinds = {n["kind"] for n in request("engineer1", "/api/notifications")[1]}
    assert {"Новая заявка", "Смена статуса", "Обновление заявки"} <= kinds
    assert request("client1", "/api/notifications")[0] == 404
    report = request("engineer1", "/api/reports?from=2020-01-01&to=2030-12-31")[1]
    assert report["kpi"]["answered"] == 1 and dict(report["by_type"]).get("Ошибка", 0) >= 1
    print("Уведомления и отчёты доступны инженеру и не доступны клиенту")

    assert request("client1", "/api/logout", {})[0] == 200 and request("client1", "/api/session")[0] == 401
    server.shutdown()
print("HTTP-интерфейс с личными входами — OK")
