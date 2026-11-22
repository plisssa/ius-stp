"""Регрессионная проверка на временной базе; запускается на macOS при работающем Ollama."""
import json
import sqlite3
import tempfile
import time
from pathlib import Path
from unittest.mock import patch
import app

with tempfile.TemporaryDirectory() as directory:
    app.DB = str(Path(directory) / "test.sqlite")
    app.init()
    db = sqlite3.connect(app.DB)
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
    print("Имитированный тайм-аут: ручной ответ зарегистрирован, срок сохранён")
    for decision in ("Отклонить","Принять"):
        start = time.monotonic()
        assert "готов" in app.suggest(db,"ES-9101")
        pid,draft = db.execute("SELECT id,draft FROM proposals WHERE decision IS NULL").fetchone()
        print("Локальный ответ за",round(time.monotonic()-start,2),"с")
        app.decide(db,"ES-9101",{"action":decision,"proposal":pid})
        actual = db.execute("SELECT answer FROM tickets WHERE id='ES-9101'").fetchone()[0]
        assert actual == (draft if decision=="Принять" else None)
    print("Отклонение сохраняет заявку открытой; принятие записывает первый ответ")
    db.close()
