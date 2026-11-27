"""Регрессионная проверка на временной базе; запускается из корня проекта при работающей Ollama с моделью."""
import json
import sqlite3
import tempfile
import time
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

import app
import classifier

with tempfile.TemporaryDirectory() as directory:
    app.DB = str(Path(directory) / "test.sqlite")
    app.init()
    db = app.connect()

    moscow = ZoneInfo("Europe/Moscow")
    at = lambda text: datetime.strptime(text, "%Y-%m-%d %H:%M").replace(tzinfo=moscow).timestamp()
    for start, priority, expected in (("2026-11-26 16:00", "P2", "2026-11-27 11:00"), ("2026-11-27 17:30", "P3", "2026-11-30 16:30"),
                                      ("2026-12-30 17:00", "P4", "2027-01-13 14:00")):
        assert app.deadline("ORG-A", priority, at(start)) == at(expected), (start, priority)
    assert app.deadline("ORG-B", "P1", at("2026-11-28 12:00")) == at("2026-11-28 13:00")
    assert app.working_days_between("ORG-A", at("2026-11-27 12:00"), at("2026-12-02 12:00")) == 3
    print("Срок SLA: рабочие часы, выходные и праздники ORG-A, календарные часы ORG-B, рабочие дни для закрытия")

    t = app.ticket_row(db, "ES-9101")
    assert t["status"] == app.WAIT_SUPPORT and t["assignee"] is None and t["deadline"] == app.deadline("ORG-A", "P2", t["registered"])
    assert db.execute("SELECT event FROM audit WHERE ticket='ES-9101'").fetchone()[0] == "Регистрация"
    print("Новая заявка: Waiting for support, Unassigned, срок от момента регистрации")

    assert classifier.available(), "Нет ml/model.json"
    kinds = {r[0] for r in db.execute("SELECT kind FROM proposals WHERE ticket='ES-9101'")}
    assert kinds == {"A1", "A2"}
    guess = classifier.predict("После обновления приложение падает при запуске, ошибка доступа к базе данных")
    assert guess["type"]["label"] in app.TYPES and guess["priority"]["label"] in app.PRIORITIES
    print("Классификатор: предложения А1 и А2 созданы при регистрации, пример:", guess["type"]["label"], guess["priority"]["label"])

    for n in range(20):
        try:
            app.read_tool("tickets.get", {"id": f"ES-X{n}"})
        except ValueError:
            pass
        else:
            raise AssertionError("Чтение несуществующей заявки")
    shown = app.read_tool("tickets.get", {"id": "ES-9101"})
    assert "author" not in shown and "author_name" not in shown and shown["id"] == "ES-9101"
    for bad in (("tickets.close", {"id": "ES-9101"}), ("tickets.get", {"id": "ES-9101", "org": "ORG-B"})):
        try:
            app.read_tool(*bad)
        except ValueError:
            pass
        else:
            raise AssertionError("Недопустимый вызов выполнен")
    print("Инструменты: 20 несуществующих заявок отклонены, данных автора нет, лишние поля и неизвестный инструмент отклонены")

    with app.tx(db):
        tid = app.register(db, "ORG-A", "client1", "Клиент Один", "Ошибка входа", "После обновления не входит в систему", "Вход", "Ошибка", "P1", "портал")
    kinds = [r[0] for r in db.execute("SELECT channel FROM notifications WHERE ticket=? AND kind='Новая заявка'", (tid,))]
    assert sorted(kinds) == ["email", "slack"]
    due = app.ticket_row(db, tid)["deadline"]
    app.sla_tick(db, due - 3000)
    app.sla_tick(db, due + 1)
    app.sla_tick(db, due + 100)
    events = [r[0] for r in db.execute("SELECT kind FROM notifications WHERE ticket=? ORDER BY id", (tid,))]
    assert events.count("Предупреждение SLA") == 1 and events.count("Нарушение SLA") == 2  # инженер и руководитель
    assert app.HEAD in [r[0] for r in db.execute("SELECT recipients FROM notifications WHERE ticket=? AND kind='Нарушение SLA'", (tid,))]
    print("SLA: предупреждение за час и нарушение отправлены один раз, нарушение — инженерам и руководителю")

    with patch.object(app.LOCAL, "open", side_effect=TimeoutError):
        assert "вручную" in app.suggest(db, "ES-9102")
    deadline = app.ticket_row(db, "ES-9102")["deadline"]
    app.decide(db, "ES-9102", {"action": "Вручную", "text": "Уточните период и фильтры выгрузки."})
    after = app.ticket_row(db, "ES-9102")
    assert after["deadline"] == deadline and after["status"] == app.WAIT_CUSTOMER and after["assignee"] == "Инженер Демо"
    print("Тайм-аут модели: ручной ответ зарегистрирован, срок сохранён, исполнитель назначен")

    for decision in ("Отклонить", "Принять"):
        start = time.monotonic()
        assert "готов" in app.suggest(db, "ES-9101"), "Модель не подготовила черновик"
        pid, draft = db.execute("SELECT id,draft FROM proposals WHERE kind='A4' AND decision IS NULL AND ticket='ES-9101'").fetchone()
        print("Черновик модели за", round(time.monotonic() - start, 2), "с")
        app.decide(db, "ES-9101", {"action": decision, "proposal": pid})
    t = app.ticket_row(db, "ES-9101")
    assert t["answer"] == draft and t["status"] == app.WAIT_CUSTOMER and t["assignee"] == "Инженер Демо"
    print("Черновик: отклонение оставляет заявку открытой, принятие регистрирует первый ответ")

    user = {"name": "Клиент Один", "org": "ORG-A"}
    app.client_action(db, "ES-9101", {"action": "Не помогло", "text": "Ошибка осталась"}, user)
    assert app.ticket_row(db, "ES-9101")["status"] == app.WAIT_SUPPORT
    app.reply(db, "ES-9101", "Попробуйте очистить кеш браузера.", "Инженер Демо")
    app.client_action(db, "ES-9101", {"action": "Помогло"}, user)
    t = app.ticket_row(db, "ES-9101")
    assert t["status"] == app.CLOSED and t["close_reason"] == "решено" and t["satisfied"] == 1
    app.client_action(db, "ES-9101", {"action": "Возобновить", "text": "Снова не входит"}, user)
    assert app.ticket_row(db, "ES-9101")["status"] == app.WAIT_SUPPORT
    try:
        app.client_action(db, "ES-9201", {"action": "Ответ", "text": "чужая"}, user)
    except ValueError:
        pass
    else:
        raise AssertionError("Клиент изменил заявку другой организации")
    print("Клиент: «не помогло», «помогло» с закрытием, возобновление; чужая организация недоступна")

    try:
        app.close(db, "ES-9102", "Инженер Демо")
    except ValueError:
        pass
    else:
        raise AssertionError("Закрытие раньше трёх рабочих дней")
    with patch.object(app, "now", return_value=time.time() + 8 * 86400):
        app.close(db, "ES-9102", "Инженер Демо")
    assert app.ticket_row(db, "ES-9102")["close_reason"] == "нет ответа клиента"
    print("Закрытие без ответа клиента — только после трёх рабочих дней")

    a1 = db.execute("SELECT id,draft FROM proposals WHERE ticket='ES-6001' AND kind='A1'").fetchone()
    app.set_type(db, "ES-6001", {"action": "Изменить", "proposal": a1["id"], "value": "Вопрос о версиях"}, "Инженер Демо")
    assert app.ticket_row(db, "ES-6001")["type"] == "Вопрос о версиях"
    report = app.reports(db, 0, time.time() + 86400)
    assert report["kpi"]["types"]["Изменить"] == 1 and report["kpi"]["drafts"]["Принять"] == 1 and report["kpi"]["drafts"]["Отклонить"] == 1
    assert any(row[0] == "Клиент Один" for row in report["unsatisfied"])
    print("Отчёты: решения по А1 и А4 учтены, отчёт о неудовлетворённых заявках строится")
    db.close()
