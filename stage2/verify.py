"""Регрессионная проверка на временной базе; запускается на macOS при работающем Ollama."""
import json
import sqlite3
import tempfile
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from unittest.mock import patch
import app

with tempfile.TemporaryDirectory() as directory:
    app.DB = str(Path(directory) / "test.sqlite")
    app.init()
    db = sqlite3.connect(app.DB)
    moscow = ZoneInfo("Europe/Moscow")
    at = lambda text: datetime.strptime(text,"%Y-%m-%d %H:%M").replace(tzinfo=moscow).timestamp()
    for start,priority,expected in (("2026-11-26 16:00","P2","2026-11-27 11:00"),("2026-11-27 17:30","P3","2026-11-30 16:30"),
                                    ("2026-12-30 17:00","P4","2027-01-13 14:00")):
        assert app.deadline("ORG-A",priority,at(start)) == at(expected), (start,priority)
    assert app.deadline("ORG-B","P1",at("2026-11-28 12:00")) == at("2026-11-28 13:00")
    print("Срок SLA: рабочие часы, выходные и праздники ORG-A, календарные часы ORG-B")
    registered,due,status,assignee = db.execute("SELECT registered,deadline,status,assignee FROM tickets WHERE id='ES-9101'").fetchone()
    assert status == "Waiting for support" and assignee is None and due == app.deadline("ORG-A","P2",registered)
    assert db.execute("SELECT event FROM audit WHERE ticket='ES-9101'").fetchone()[0] == "Регистрация"
    print("Новая заявка: Waiting for support, Unassigned, срок от момента регистрации")
    for n in range(20):
        try:
            app.read_tool("tickets.get", {"id":"ES-9201" if n % 2 else f"ES-X{n}"})
        except ValueError:
            pass
        else:
            raise AssertionError("Доступ вне области")
    print("20 запросов чужой или отсутствующей заявки отклонены")
    try:
        app.read_tool("tickets.close", {"id":"ES-9101"})
    except ValueError:
        print("Инструмент изменения статуса недоступен")
    else:
        raise AssertionError("Неизвестный инструмент выполнен")
    with patch.object(app.LOCAL,"open",side_effect=TimeoutError):
        assert "вручную" in app.suggest(db,"ES-9102")
    deadline = db.execute("SELECT deadline FROM tickets WHERE id='ES-9102'").fetchone()
    app.decide(db,"ES-9102",{"action":"Вручную","text":"Проверьте фильтры."})
    assert deadline == db.execute("SELECT deadline FROM tickets WHERE id='ES-9102'").fetchone()
    assert db.execute("SELECT status,assignee FROM tickets WHERE id='ES-9102'").fetchone() == ("Waiting for customer","Инженер Демо")
    print("Имитированный тайм-аут: ручной ответ зарегистрирован, срок сохранён")
    for decision in ("Отклонить","Принять"):
        start = time.monotonic()
        assert "готов" in app.suggest(db,"ES-9101")
        pid,draft = db.execute("SELECT id,draft FROM proposals WHERE decision IS NULL").fetchone()
        print("Локальный ответ за",round(time.monotonic()-start,2),"с")
        app.decide(db,"ES-9101",{"action":decision,"proposal":pid})
        actual = db.execute("SELECT answer FROM tickets WHERE id='ES-9101'").fetchone()[0]
        assert actual == (draft if decision=="Принять" else None)
        expected = ("Waiting for customer","Инженер Демо") if decision=="Принять" else ("Waiting for support",None)
        assert db.execute("SELECT status,assignee FROM tickets WHERE id='ES-9101'").fetchone() == expected
    print("Отклонение сохраняет заявку открытой; первый ответ назначает исполнителя и меняет статус на Waiting for customer")
    db.close()
