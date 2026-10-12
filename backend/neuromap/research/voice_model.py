"""
Serve the experimental Parkinson's voice model inside the app.

The model is only run on the held-out people from the public dataset (people it never saw
during training), so the app can demonstrate it honestly. It is not run on NeuroMap users:
the dataset uses sustained "ahh" recordings with features NeuroMap does not compute yet.
"""
import json
import os
from functools import lru_cache

import numpy as np

RESULTS = os.path.join(os.path.dirname(__file__), "results")


@lru_cache(maxsize=1)
def _load():
    import joblib   # imported lazily so the rest of the app still runs without scikit-learn
    model = joblib.load(os.path.join(RESULTS, "voice_model.joblib"))
    held = np.load(os.path.join(RESULTS, "held_out_people.npz"))
    with open(os.path.join(RESULTS, "voice_model_results.json")) as f:
        report = json.load(f)
    X, y, groups = held["X"].astype(float), held["y"].astype(int), held["groups"]
    prob = model.predict_proba(X)[:, 1]
    people = []
    for i, g in enumerate(dict.fromkeys(groups.tolist())):       # keep dataset order
        m = groups == g
        p = float(prob[m].mean())
        people.append({
            "person": i + 1,
            "recordings": [round(float(v), 3) for v in prob[m]],
            "probability": round(p, 3),
            "predicted_parkinsons": p >= 0.5,
            "actual_parkinsons": bool(y[m][0]),
        })
    return report, people


def summary() -> dict:
    report, people = _load()
    correct = sum(p["predicted_parkinsons"] == p["actual_parkinsons"] for p in people)
    return {**report, "held_out_people": len(people), "held_out_correct": correct}


def person(n: int) -> dict:
    _, people = _load()
    if not 1 <= n <= len(people):
        raise KeyError(n)
    return people[n - 1]
