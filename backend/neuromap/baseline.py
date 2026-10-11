"""
Personal baseline, deviation scores, and domain scores.

Instead of comparing someone to a population average, each measurement is compared
with that same person's own history:

    z = (x_today - median(history)) / robust_sd(history)

Median/MAD are used instead of mean/SD so one bad session (noisy room, bad lighting)
doesn't wreck the baseline.

A domain score is 100 when every feature in that domain sits at the person's usual
level, and falls as features move in the adverse direction. It is a "change from
your normal" index, NOT a health or disease score.
"""

import numpy as np

from .registry import BY_KEY, DOMAINS

MIN_BASELINE = 3      # sessions needed before we score anything
BASELINE_WINDOW = 6   # use the first N sessions as the reference period
ADVERSE_Z = 2.0       # |z| beyond this in the adverse direction is flagged
POINTS_PER_Z = 15.0   # domain score drops 15 points per unit of mean adverse z
Z_CAP = 5.0           # one wildly-off feature can't zero a whole domain


def robust_stats(values: list[float]) -> tuple[float, float]:
    v = np.asarray([x for x in values if x is not None and np.isfinite(x)], dtype=float)
    med = float(np.median(v))
    mad = float(np.median(np.abs(v - med))) * 1.4826
    # Floor the spread so a near-constant history doesn't produce huge z-scores
    floor = max(0.05 * abs(med), 1e-3)
    return med, max(mad, floor)


def compute_baseline(history: list[dict]) -> dict[str, tuple[float, float]]:
    """history: list of feature dicts from earlier assessments (oldest first)."""
    ref = history[:BASELINE_WINDOW]
    keys = {k for h in ref for k in h}
    out = {}
    for k in keys:
        vals = [h[k] for h in ref if k in h]
        if len(vals) >= MIN_BASELINE:
            out[k] = robust_stats(vals)
    return out


def zscores(features: dict, baseline: dict) -> dict[str, float]:
    return {k: (v - baseline[k][0]) / baseline[k][1] for k, v in features.items() if k in baseline}


def adverse(key: str, z: float) -> float | None:
    f = BY_KEY.get(key)
    if f is None or f.higher_is_worse is None:
        return None
    return z if f.higher_is_worse else -z


def domain_scores(z: dict[str, float]) -> dict[str, float | None]:
    scores = {}
    for d in DOMAINS:
        adv = [adverse(k, v) for k, v in z.items() if BY_KEY.get(k) and BY_KEY[k].domain == d]
        adv = [a for a in adv if a is not None]
        if not adv:
            scores[d] = None
            continue
        mean_adv = float(np.mean(np.clip(adv, 0, Z_CAP)))
        scores[d] = float(np.clip(100 - POINTS_PER_Z * mean_adv, 0, 100))
    return scores


def feature_importance(z: dict[str, float], domain: str) -> list[dict]:
    """Rank the strongest adverse contributors for a domain."""
    rows = []
    for key, value in z.items():
        f = BY_KEY.get(key)
        if f is None or f.domain != domain:
            continue
        adv = adverse(key, value)
        if adv is None or adv <= 0:
            continue
        rows.append({
            "key": key,
            "label": f.label,
            "value": float(adv),
            "direction": "higher" if f.higher_is_worse else "lower",
        })

    if not rows:
        return []

    total = sum(item["value"] for item in rows)
    ranked = sorted(rows, key=lambda item: item["value"], reverse=True)
    return [{
        "key": item["key"],
        "label": item["label"],
        "direction": item["direction"],
        "share": float(item["value"] / total),
    } for item in ranked]


def detect_change_points(assessments: list[dict]) -> list[dict]:
    """Find a domain score split with a substantial change in its mean level."""
    change_points = []
    for domain in DOMAINS:
        values = [
            {"index": index, "assessment": assessment, "score": assessment.get("scores", {}).get(domain)}
            for index, assessment in enumerate(assessments)
            if assessment.get("scores", {}).get(domain) is not None
        ]
        if len(values) < 5:
            continue

        scores = np.asarray([item["score"] for item in values], dtype=float)
        total_error = float(np.sum((scores - np.mean(scores)) ** 2))
        best = None
        for split in range(2, len(scores) - 1):
            before, after = scores[:split], scores[split:]
            delta = float(np.mean(after) - np.mean(before))
            error = float(np.sum((before - np.mean(before)) ** 2) + np.sum((after - np.mean(after)) ** 2))
            if best is None or error < best["error"]:
                best = {"split": split, "delta": delta, "error": error}

        if best is None or abs(best["delta"]) < 8 or total_error == 0:
            continue
        improvement = 1 - best["error"] / total_error
        if improvement < 0.5:
            continue

        assessment = values[best["split"]]["assessment"]
        change_points.append({
            "domain": domain,
            "index": values[best["split"]]["index"],
            "assessment_id": assessment.get("id"),
            "created_at": assessment.get("created_at"),
            "delta": best["delta"],
            "fit_improvement": float(improvement),
        })

    return sorted(change_points, key=lambda item: abs(item["delta"]), reverse=True)


def score_timeline(assessments: list[dict]) -> tuple[list[dict], dict]:
    """
    assessments: [{"id", "created_at", "features": {...merged across labs...}}, ...] oldest first.
    Adds baseline-relative z, domain scores, flags, and a profile-distance value to each.
    Assessments used to build the baseline are marked calibrating.
    """
    history = [a["features"] for a in assessments]
    baseline = compute_baseline(history)
    out = []
    streak: dict[str, int] = {}
    for i, a in enumerate(assessments):
        calibrating = i < MIN_BASELINE
        z = zscores(a["features"], baseline) if baseline else {}
        flags = []
        for k, v in z.items():
            adv = adverse(k, v)
            if adv is not None and adv > ADVERSE_Z:
                flags.append(k)
            # sustained change: 3 consecutive sessions beyond 1.5 in the adverse direction
            streak[k] = streak.get(k, 0) + 1 if (adv is not None and adv > 1.5) else 0
        sustained = [k for k, n in streak.items() if n >= 3]
        dist = float(np.sqrt(np.mean([v ** 2 for v in z.values()]))) if z else None
        out.append({
            **a,
            "calibrating": calibrating,
            "z": z,
            "scores": domain_scores(z) if z and not calibrating else {d: None for d in DOMAINS},
            "flags": flags if not calibrating else [],
            "sustained": sustained if not calibrating else [],
            "profile_distance": dist,
        })
    return out, baseline
