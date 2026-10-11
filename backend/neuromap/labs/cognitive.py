"""
Cognitive Lab: WORKED EXAMPLE.

This module is fully implemented so you can see the contract every lab follows.
The other labs (motor.py, voice.py, sensors.py) use the same shape:

    analyze(raw: dict) -> {"features": {feature_key: float, ...},
                           "trace":    {...anything Research Mode should plot...}}

- `features` keys must exist in registry.py.
- `trace` is free-form JSON (lists of numbers) that the Research Mode page draws
  as the "signal" stage of the pipeline. Keep it small (downsample to a few
  hundred points at most).

Raw input from the browser (see frontend/src/labs/CognitiveLab.jsx):

    {
      "reaction": [ {"stimulus_ms": 1234.5, "response_ms": 1502.1, "false_start": false}, ... ],
      "span":     [ {"length": 4, "correct": true}, {"length": 5, "correct": false}, ... ]
    }

Times come from performance.now() in the browser, so they are in milliseconds.
"""

import numpy as np

LAPSE_MS = 500.0      # standard psychomotor-vigilance lapse threshold
MIN_VALID_RT = 100.0  # anything faster is anticipation, not reaction


def reaction_features(trials: list[dict]) -> tuple[dict, dict]:
    rts = []
    false_starts = 0
    for tr in trials:
        if tr.get("false_start"):
            false_starts += 1
            continue
        rt = tr["response_ms"] - tr["stimulus_ms"]
        if rt < MIN_VALID_RT:
            false_starts += 1   # anticipatory response
            continue
        rts.append(rt)

    rts = np.asarray(rts, dtype=float)
    if len(rts) < 3:
        raise ValueError("Need at least 3 valid reaction-time trials.")

    # Trimming: drop RTs > 3 SD from the median as outliers, but still count lapses on the full set.
    med = float(np.median(rts))
    mad = float(np.median(np.abs(rts - med))) * 1.4826 or 1.0
    kept = rts[np.abs(rts - med) <= 3 * mad]

    # Learning effect: slope of RT across trial index (ms per trial). Negative = getting faster.
    idx = np.arange(len(rts))
    slope = float(np.polyfit(idx, rts, 1)[0]) if len(rts) >= 3 else 0.0

    features = {
        "cog_rt_median_ms": med,
        "cog_rt_cv": float(np.std(kept, ddof=1) / np.mean(kept) * 100),
        "cog_lapses": float(np.sum(rts > LAPSE_MS)),
        "cog_false_starts": float(false_starts),
    }
    trace = {
        "rt_ms": [round(x, 1) for x in rts.tolist()],
        "rt_mean_ms": float(np.mean(rts)),
        "rt_sd_ms": float(np.std(rts, ddof=1)),
        "learning_slope_ms_per_trial": slope,
        "outliers_removed": int(len(rts) - len(kept)),
    }
    return features, trace


def span_features(trials: list[dict]) -> tuple[dict, dict]:
    correct_lengths = [t["length"] for t in trials if t["correct"]]
    max_span = max(correct_lengths) if correct_lengths else 0
    accuracy = sum(t["correct"] for t in trials) / len(trials) if trials else 0.0
    return (
        {"cog_max_span": float(max_span), "cog_span_accuracy": float(accuracy * 100)},
        {"span_trials": trials, "span_accuracy": accuracy},
    )


def analyze(raw: dict) -> dict:
    features, trace = {}, {}
    if raw.get("reaction"):
        f, t = reaction_features(raw["reaction"])
        features.update(f)
        trace.update(t)
    if raw.get("span"):
        f, t = span_features(raw["span"])
        features.update(f)
        trace.update(t)
    if not features:
        raise ValueError("No cognitive trials submitted.")
    return {"features": features, "trace": trace}
