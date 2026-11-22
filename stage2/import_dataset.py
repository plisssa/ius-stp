"""python3 import_dataset.py dataset-tickets-multi-lang-4-20k.csv"""
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

path = Path(__file__).with_name("data.json")
data = json.loads(path.read_text())
tickets = [t for t in data["tickets"] if "row" not in t]
articles = [a for a in data["articles"] if a["id"] in ("KB-01", "KB-02")]
topics = [
    ("Синхронизация", r"sync|integrat", "Уточните названия интегрируемых систем и время последней успешной синхронизации."),
    ("Производительность", r"performance|slow|latency|memory|crash", "Уточните версию приложения, действие перед замедлением и время сбоя."),
    ("Обновление", r"install|update|upgrad|version", "Уточните установленную версию, ожидаемую версию и сообщение установщика."),
    ("Подключение", r"connect|network|offline", "Уточните, к какому сервису не удаётся подключиться и какое сообщение выводится."),
]
for number,(topic,_,question) in enumerate(topics,3):
    articles.append({"id":f"KB-{number:02}","topic":topic,"text":"Первичная диагностика. "+question,"question":question})
translated = {t["row"]: t for t in data["tickets"] if "source_hash" in t}
counts = dict.fromkeys([t[0] for t in topics], 0)
seen = set()
for row,r in enumerate(csv.DictReader(open(sys.argv[1],encoding="utf-8-sig")),2):
    title = r["subject"].strip()
    if r["language"]!="en" or r["queue"] not in ("Technical Support","IT Support") or title.casefold() in seen:
        continue
    topic = next((name for name,pattern,_ in topics if re.search(pattern,title,re.I)),None)
    if topic is None or counts[topic]>=60:
        continue
    body=r["body"].strip()
    if not body or len(body)>3000 or re.search(r"@|https?://|\b\d{7,}\b",title+body):
        continue
    seen.add(title.casefold())
    counts[topic]+=1
    digest = hashlib.sha256((title+"\n"+body).encode()).hexdigest()
    ru = translated.get(row)
    if ru is None or ru["source_hash"] != digest:
        raise ValueError(f"Для изменённой исходной строки {row} требуется перевод")
    tickets.append({"id":f"ES-{6000+sum(counts.values())}","org":"ORG-A","topic":topic,"priority":{"high":"P2","medium":"P3","low":"P4"}[r["priority"]],"title":ru["title"],"body":ru["body"],"row":row,"source_hash":digest})
if sum(counts.values())<200:
    raise ValueError(counts)
data.update(tickets=tickets,articles=articles)
path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n")
print(counts)
