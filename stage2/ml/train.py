"""Обучение классификатора обращений: тип (А1) и приоритет по описанию (А2).

Нужны scikit-learn и переведённые на русский обращения (ru.jsonl, см. ml/README.md).
Запуск: python3 ml/train.py ru.jsonl dataset-tickets-multi-lang-4-20k.csv
Результат: ml/model.json (веса для classifier.py) и ml/metrics.json.
"""
import csv
import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split

HERE = Path(__file__).resolve().parent
# Типы набора данных → справочник типов кейса (ASM-11). «Вопрос о версиях» в наборе не выделен.
TYPE_MAP = {"Incident": "Ошибка", "Problem": "Ошибка", "Request": "Вопрос по функционалу", "Change": "Вопрос по конфигурации"}
PRIORITY_MAP = {"high": "P2", "medium": "P3", "low": "P4"}  # как в import_dataset.py
SEED = 42

ru_path, csv_path = Path(sys.argv[1]), Path(sys.argv[2])
rows = [json.loads(line) for line in ru_path.read_text(encoding="utf-8").splitlines()]
texts = [r["title"] + ". " + r["body"] for r in rows]
labels = {"type": [TYPE_MAP[r["type"]] for r in rows], "priority": [PRIORITY_MAP[r["priority"]] for r in rows]}

# Отложенная выборка 20 %, стратификация по типу; демонстрационные заявки стенда в обучение не входят.
idx_train, idx_test = train_test_split(range(len(rows)), test_size=0.2, random_state=SEED, stratify=labels["type"])
vec = TfidfVectorizer(lowercase=True, ngram_range=(1, 2), min_df=2, max_features=20000, sublinear_tf=True)
X_train = vec.fit_transform([texts[i] for i in idx_train])
X_test = vec.transform([texts[i] for i in idx_test])

# Демонстрационные заявки стенда: перевод из data.json, исходная разметка из CSV.
original = {}
with csv_path.open(encoding="utf-8") as f:
    for n, r in enumerate(csv.DictReader(f), start=2):
        original[n] = r
demo = [t for t in json.loads((HERE.parent / "data.json").read_text())["tickets"] if t.get("row")]
X_demo = vec.transform([t["title"] + ". " + t["body"] for t in demo])

heads, metrics = {}, {"trained": date.today().isoformat(), "train": len(idx_train), "test": len(idx_test), "demo": len(demo), "heads": {}}
for name, mapping, src in (("type", TYPE_MAP, "type"), ("priority", PRIORITY_MAP, "priority")):
    y = labels[name]
    y_train, y_test = [y[i] for i in idx_train], [y[i] for i in idx_test]
    clf = LogisticRegression(max_iter=3000, C=4.0, class_weight="balanced")
    clf.fit(X_train, y_train)
    pred = clf.predict(X_test)
    majority = Counter(y_train).most_common(1)[0][0]
    y_demo = [mapping[original[t["row"]][src]] for t in demo]
    pred_demo = clf.predict(X_demo)
    classes = list(clf.classes_)
    metrics["heads"][name] = {
        "classes": classes,
        "accuracy": round(accuracy_score(y_test, pred), 3),
        "macro_f1": round(f1_score(y_test, pred, average="macro"), 3),
        "baseline_majority": round(accuracy_score(y_test, [majority] * len(y_test)), 3),
        "per_class": {c: {k: round(v, 3) for k, v in d.items() if k != "support"} | {"support": d["support"]}
                      for c, d in classification_report(y_test, pred, output_dict=True, zero_division=0).items() if c in classes},
        "confusion": {"labels": classes, "matrix": confusion_matrix(y_test, pred, labels=classes).tolist()},
        "demo_accuracy": round(accuracy_score(y_demo, pred_demo), 3),
        "demo_macro_f1": round(f1_score(y_demo, pred_demo, average="macro"), 3),
    }
    heads[name] = {"labels": classes, "coef": [[round(float(v), 4) for v in row] for row in clf.coef_],
                   "intercept": [round(float(v), 4) for v in clf.intercept_], "model": clf}

vocab = {term: int(j) for term, j in vec.vocabulary_.items()}
model = {"version": "1.0 · " + metrics["trained"], "trained_on": "Customer Support Tickets (Tobi Bueck, CC BY-NC 4.0), переведено en→ru",
         "type_map": TYPE_MAP, "priority_map": PRIORITY_MAP, "metrics": {k: {m: v[m] for m in ("accuracy", "macro_f1", "baseline_majority", "demo_accuracy")} for k, v in metrics["heads"].items()},
         "vectorizer": {"vocab": vocab, "idf": [round(float(v), 5) for v in vec.idf_]},
         "heads": {k: {kk: vv for kk, vv in v.items() if kk != "model"} for k, v in heads.items()}}
(HERE / "model.json").write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")))

# Проверка совпадения с расчётом в classifier.py.
sys.path.insert(0, str(HERE.parent))
import classifier  # noqa: E402
classifier._model = None
worst = 0.0
for i in list(idx_test)[:300]:
    ours = classifier.predict(texts[i])
    for name in ("type", "priority"):
        ref = heads[name]["model"].predict_proba(vec.transform([texts[i]]))[0]
        for label, p in zip(heads[name]["labels"], ref):
            worst = max(worst, abs(ours[name]["probs"][label] - p))
metrics["parity_max_abs_diff"] = round(worst, 4)
metrics["label_distribution"] = {k: Counter(v) for k, v in labels.items()}
(HERE / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=1))
print(json.dumps({k: metrics["heads"][k] | {"per_class": "…", "confusion": "…"} for k in metrics["heads"]}, ensure_ascii=False, indent=1))
print("parity", metrics["parity_max_abs_diff"], "vocab", len(vocab), "size", round((HERE / "model.json").stat().st_size / 1e6, 2), "MB")
