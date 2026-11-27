"""Учебный MCP-сервер чтения. Одна строка JSON-RPC на запрос и ответ.

tickets.get читает заявку из базы только на чтение и не отдаёт данные автора (ИИ-06);
kb.search возвращает утверждённую статью базы знаний по теме.
"""
import json
import os
import sqlite3
import sys
from pathlib import Path

data = json.loads(Path(__file__).with_name("data.json").read_text())
SCOPE = set(filter(None, os.getenv("STP_TOOL_ORGS", "").split(",")))  # пусто — все организации
FIELDS = ("id", "org", "topic", "type", "priority", "title", "body")
tools = {
    "tickets.get": ("id", "Получить текущую заявку без данных автора"),
    "kb.search": ("topic", "Найти утверждённую статью по теме"),
}


def ticket(tid):
    db = sqlite3.connect(f"file:{os.environ['STP_DB']}?mode=ro", uri=True, timeout=5)
    try:
        row = db.execute(f"SELECT {','.join(FIELDS)} FROM tickets WHERE id=?", (tid,)).fetchone()
    finally:
        db.close()
    if row is None or (SCOPE and row[1] not in SCOPE):
        return None
    return dict(zip(FIELDS, row))


def handle(request):
    method = request["method"]
    if method == "initialize":
        return {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "stp-demo", "version": "2.0"}}
    if method == "tools/list":
        return {"tools": [{"name": name, "description": desc, "inputSchema": {"type": "object", "properties": {key: {"type": "string"}}, "required": [key], "additionalProperties": False}} for name, (key, desc) in tools.items()]}
    if method != "tools/call":
        raise ValueError("Неизвестный метод")
    name = request["params"]["name"]
    key = tools[name][0]
    args = request["params"]["arguments"]
    if set(args) != {key} or not isinstance(args[key], str):
        raise ValueError("Недопустимые поля")
    row = ticket(args[key]) if name == "tickets.get" else next((a for a in data["articles"] if a["topic"] == args[key]), None)
    if row is None:
        raise ValueError("Данные недоступны")
    return {"content": [{"type": "text", "text": json.dumps(row, ensure_ascii=False)}]}


def serve(input_lines, output):
    for line in input_lines:
        req = json.loads(line)
        if "id" not in req:
            continue
        response = {"jsonrpc": "2.0", "id": req["id"]}
        try:
            response["result"] = handle(req)
        except (KeyError, ValueError, TypeError, sqlite3.Error):
            response["error"] = {"code": -32602, "message": "Запрос отклонён"}
        print(json.dumps(response), file=output, flush=True)


if __name__ == "__main__":
    serve(sys.stdin, sys.stdout)
