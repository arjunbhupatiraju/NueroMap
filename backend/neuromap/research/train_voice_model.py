"""
Experimental Parkinson's voice classifier, trained on a public dataset.

This is a research experiment that lives next to NeuroMap. It is NOT used by the app's
scoring, which compares each person only with their own baseline.

Supported datasets (download from the UCI Machine Learning Repository and put the file in
backend/data/research/):
  * "Parkinson's Disease Classification" (Sakar et al., 2018), UCI id 470
      file: pd_speech_features.csv   (756 recordings, 252 people, 3 recordings each)
  * "Parkinsons" (Little et al., 2007), UCI id 174
      file: parkinsons.data          (195 recordings, 31 people)

Every person has several recordings, so all splits are grouped by person: a person's
recordings are never split between training and testing. Splitting by recording instead
would leak the same voice into both sides and inflate accuracy.

Procedure
  1. Hold out 20% of people (stratified by diagnosis) as a final test set. It is not touched
     until the very end.
  2. On the remaining people, compare a simple baseline (logistic regression) with the chosen
     model (histogram gradient boosting) using 5-fold person-grouped cross-validation.
     (Model choice was made by comparing several model types on these development people only.)
  3. Train the chosen model on all development people and score the held-out people once.
  4. Save that model plus the held-out people so the app can demonstrate it on people the
     model has never seen.

Usage:
    pip install -r requirements-research.txt
    python -m neuromap.research.train_voice_model data/research/pd_speech_features.csv
"""

import json
import os
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, balanced_accuracy_score, roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "research")   # dataset goes here (not committed)
OUT_DIR = os.path.join(os.path.dirname(__file__), "results")                           # results + model are committed


def load(path: str):
    """Return X (features), y (1 = Parkinson's), groups (person id), dataset name."""
    name = os.path.basename(path)
    if name.endswith(".data") or "status" in open(path).readline():
        df = pd.read_csv(path)                                    # Little et al. 2007
        groups = df["name"].str.extract(r"(S\d+)")[0]            # phon_R01_S01_1 -> S01
        y = df["status"].astype(int)
        X = df.drop(columns=["name", "status"])
        return X, y, groups, "UCI Parkinsons (Little et al., 2007)"
    df = pd.read_csv(path, header=1)                              # Sakar et al. 2018
    groups = df["id"]
    y = df["class"].astype(int)
    X = df.drop(columns=["id", "class"])
    return X, y, groups, "UCI Parkinson's Disease Classification (Sakar et al., 2018)"


MODELS = {
    "logistic_regression": lambda: make_pipeline(
        StandardScaler(), LogisticRegression(max_iter=5000, C=0.01, class_weight="balanced")),
    "gradient_boosting": lambda: HistGradientBoostingClassifier(class_weight="balanced", random_state=0),
}
CHOSEN = "gradient_boosting"


def person_metrics(y, groups, prob) -> dict:
    """Average each person's recordings, then score people (threshold 0.5)."""
    d = pd.DataFrame({"g": np.asarray(groups), "y": np.asarray(y), "p": prob}).groupby("g").mean()
    pred = (d["p"] >= 0.5).astype(int)
    pos, neg = d["y"] == 1, d["y"] == 0
    return {
        "people": int(len(d)),
        "accuracy": round(float(accuracy_score(d["y"], pred)), 3),
        "balanced_accuracy": round(float(balanced_accuracy_score(d["y"], pred)), 3),
        "roc_auc": round(float(roc_auc_score(d["y"], d["p"])), 3),
        "sensitivity": round(float((pred[pos] == 1).mean()), 3),   # Parkinson's correctly flagged
        "specificity": round(float((pred[neg] == 0).mean()), 3),   # healthy correctly cleared
    }


def cross_validate(make, X, y, groups, k: int = 5) -> dict:
    prob = np.zeros(len(y))
    for train, test in StratifiedGroupKFold(n_splits=k, shuffle=True, random_state=0).split(X, y, groups):
        m = make()
        m.fit(X[train], y[train])
        prob[test] = m.predict_proba(X[test])[:, 1]
    return person_metrics(y, groups, prob)


def main(path: str):
    Xdf, ys, gs, dataset = load(path)
    X, y, groups = Xdf.to_numpy(dtype=float), ys.to_numpy(), gs.to_numpy()
    print(f"{dataset}: {len(y)} recordings, {len(set(groups))} people, {X.shape[1]} voice features")

    dev, test = next(StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=42).split(X, y, groups))
    print(f"development: {len(set(groups[dev]))} people   held-out test: {len(set(groups[test]))} people")

    cv = {}
    for name, make in MODELS.items():
        cv[name] = cross_validate(make, X[dev], y[dev], groups[dev])
        print(f"  CV {name:20s} {cv[name]}")

    model = MODELS[CHOSEN]()
    model.fit(X[dev], y[dev])
    held_prob = model.predict_proba(X[test])[:, 1]
    held = person_metrics(y[test], groups[test], held_prob)
    print(f"  HELD-OUT {CHOSEN:14s} {held}")

    os.makedirs(OUT_DIR, exist_ok=True)
    report = {
        "dataset": dataset, "recordings": int(len(y)), "people": int(len(set(groups))),
        "parkinsons_people": int(pd.Series(y).groupby(groups).first().sum()), "features": int(X.shape[1]),
        "model": CHOSEN, "evaluation": "people never seen in training; each person's recordings averaged",
        "cross_validation_development": cv, "held_out_test": held,
        "always_guess_parkinsons_accuracy": round(float(pd.Series(y[test]).groupby(groups[test]).first().mean()), 3),
    }
    with open(os.path.join(OUT_DIR, "voice_model_results.json"), "w") as f:
        json.dump(report, f, indent=2)
    joblib.dump(model, os.path.join(OUT_DIR, "voice_model.joblib"), compress=3)
    np.savez_compressed(os.path.join(OUT_DIR, "held_out_people.npz"),
                        X=X[test].astype(np.float32), y=y[test], groups=groups[test])
    print("saved model, held-out people and results to", OUT_DIR)
    return report


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(DATA_DIR, "pd_speech_features.csv"))
