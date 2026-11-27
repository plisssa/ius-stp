"""Классификатор обращений (предложения А1 и А2) без внешних библиотек.

Модель обучена скриптом ml/train.py (TF-IDF по словам и парам слов + логистическая регрессия)
и сохранена в ml/model.json; здесь повторён расчёт scikit-learn: признаки, idf, l2-нормировка, softmax.
"""
import json
import math
import re
from pathlib import Path

PATH = Path(__file__).with_name("ml") / "model.json"
TOKEN = re.compile(r"(?u)\b\w\w+\b")
_model = None


def _load():
    global _model
    if _model is None and PATH.exists():
        _model = json.loads(PATH.read_text())
    return _model


def available():
    return _load() is not None


def version():
    m = _load()
    return m["version"] if m else "—"


def info():
    m = _load()
    if not m:
        return None
    return {"version": m["version"], "trained_on": m["trained_on"], "metrics": m["metrics"]}


def features(text):
    m = _load()
    vocab, idf = m["vectorizer"]["vocab"], m["vectorizer"]["idf"]
    tokens = TOKEN.findall(text.lower())
    grams = tokens + [a + " " + b for a, b in zip(tokens, tokens[1:])]
    counts = {}
    for g in grams:
        j = vocab.get(g)
        if j is not None:
            counts[j] = counts.get(j, 0) + 1
    vec = {j: (1 + math.log(c)) * idf[j] for j, c in counts.items()}
    norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
    return {j: v / norm for j, v in vec.items()}


def _head(name, x):
    head = _load()["heads"][name]
    scores = [b + sum(w[j] * v for j, v in x.items()) for w, b in zip(head["coef"], head["intercept"])]
    top = max(scores)
    exp = [math.exp(s - top) for s in scores]
    total = sum(exp)
    probs = [e / total for e in exp]
    best = max(range(len(probs)), key=probs.__getitem__)
    labels = head["labels"]
    return {"label": labels[best], "p": round(probs[best], 4), "probs": dict(zip(labels, (round(p, 4) for p in probs)))}


def predict(text):
    x = features(text)
    return {"type": _head("type", x), "priority": _head("priority", x)}
