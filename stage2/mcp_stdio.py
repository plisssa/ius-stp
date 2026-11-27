"""Учебный MCP-сервер чтения. Одна строка JSON-RPC на запрос и ответ."""
import json
import sys
from pathlib import Path

data = json.loads(Path(__file__).with_name("data.json").read_text())
org = "ORG-A"
tools = {
    "tickets.get": ("id","Получить учебную заявку организации инженера"),
    "kb.search": ("topic","Найти утверждённую статью по теме")
}


def handle(request):
    method = request["method"]
    if method == "initialize":
        return {"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"stp-demo","version":"1.0"}}
    if method == "tools/list":
        return {"tools":[{"name":name,"description":desc,"inputSchema":{"type":"object","properties":{key:{"type":"string"}},"required":[key],"additionalProperties":False}} for name,(key,desc) in tools.items()]}
    if method != "tools/call":
        raise ValueError("Неизвестный метод")
    name = request["params"]["name"]
    key = tools[name][0]
    args = request["params"]["arguments"]
    if set(args) != {key}:
        raise ValueError("Недопустимые поля")
    allowed = [t for t in data["tickets"] if t["org"] == org] if name=="tickets.get" else data["articles"]
    row = next((r for r in allowed if r[key]==args[key]),None)
    if row is None:
        raise ValueError("Данные недоступны")
    return {"content":[{"type":"text","text":json.dumps(row,ensure_ascii=False)}]}


def serve(input_lines, output):
    for line in input_lines:
        req = json.loads(line)
        if "id" not in req:
            continue
        response = {"jsonrpc":"2.0","id":req["id"]}
        try:
            response["result"] = handle(req)
        except (KeyError,ValueError,TypeError):
            response["error"] = {"code":-32602,"message":"Запрос отклонён"}
        print(json.dumps(response),file=output,flush=True)


if __name__ == "__main__":
    serve(sys.stdin,sys.stdout)
