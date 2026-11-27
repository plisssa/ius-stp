"""Перевод англоязычных обращений техподдержки на русский (Argos en→ru 1.9 через ctranslate2)."""
import csv, json, re, sys, time
from pathlib import Path
import ctranslate2, sentencepiece

src, model_dir, used_json, out = map(Path, sys.argv[1:5])
QUEUES = {"Technical Support", "Product Support", "IT Support", "Service Outages and Maintenance"}
used = {t.get("row") for t in json.loads(used_json.read_text())["tickets"] if t.get("row")}
rows = []
with src.open(encoding="utf-8") as f:
    for n, r in enumerate(csv.DictReader(f), start=2):
        if r["language"] == "en" and r["queue"] in QUEUES and n not in used and r["subject"].strip() and r["body"].strip():
            rows.append((n, r))
print("rows", len(rows), "excluded demo rows", len(used), flush=True)
sp = sentencepiece.SentencePieceProcessor(model_file=str(model_dir / "sentencepiece.model"))
tr = ctranslate2.Translator(str(model_dir / "model"), device="cpu", compute_type="int8", inter_threads=4)

def sentences(text, limit=400):
    text = re.sub(r"\s+", " ", text).strip()[:limit]
    return [s for s in re.split(r"(?<=[.!?])\s+", text) if s]

done = {}
if out.exists():
    for line in out.read_text().splitlines():
        d = json.loads(line); done[d["row"]] = d
start = time.time()
with out.open("a", encoding="utf-8") as fo:
    batch = []
    def flush():
        segs, owners = [], []
        for n, r in batch:
            parts = [r["subject"].strip()] + sentences(r["body"])
            for i, s in enumerate(parts):
                segs.append(sp.encode(s, out_type=str)); owners.append((n, i))
        res = tr.translate_batch(segs, beam_size=2, max_batch_size=64)
        by = {}
        for (n, i), rr in zip(owners, res):
            by.setdefault(n, []).append(sp.decode(rr.hypotheses[0]))
        for n, r in batch:
            ru = by[n]
            fo.write(json.dumps({"row": n, "title": ru[0], "body": " ".join(ru[1:]), "type": r["type"], "priority": r["priority"], "queue": r["queue"]}, ensure_ascii=False) + "\n")
        fo.flush()
        batch.clear()
    k = 0
    for n, r in rows:
        if n in done: continue
        batch.append((n, r)); k += 1
        if len(batch) == 32:
            flush()
            if k % 640 == 0: print(k, "translated", round(time.time() - start), "s", flush=True)
    if batch: flush()
print("done", round(time.time() - start), "s", flush=True)
