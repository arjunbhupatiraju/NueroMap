"""
Builds the synthetic demo profile: 10 weekly assessments generated as RAW signals and
run through the real pipelines. From week 6 onward a gradual motor + speech change is
injected (slower, shrinking taps; flatter, more hesitant speech) while gait, balance and
cognition stay stable, so the dashboard shows a domain-specific deviation.
"""

from datetime import datetime, timedelta, timezone

import numpy as np

from . import store, synth
from .labs import cognitive, motor, sensors, voice

DEMO_PROFILE = "Demo (synthetic)"


def seed(weeks: int = 10, change_from: int = 6) -> str:
    store.delete_profile(DEMO_PROFILE)
    r = np.random.default_rng(42)
    start = datetime.now(timezone.utc) - timedelta(weeks=weeks - 1)
    for w in range(weeks):
        c = max(0, w - change_from + 1) / (weeks - change_from)   # 0 -> 1 ramp after onset
        j = lambda s: r.normal(0, s)  # noqa: E731  (week-to-week natural variation)
        aid = store.create_assessment(DEMO_PROFILE, (start + timedelta(weeks=w)).isoformat(), synthetic=True)
        seed_ = 1000 * w

        m = motor.analyze({"hands": {
            "right": synth.tapping_hand(freq=4.6 - 0.6 * c + j(0.15), amp=0.85 - 0.1 * c + j(0.03),
                                        decrement=0.05 + 0.15 * c, interval_cv=5 + 3 * c + abs(j(0.8)), seed=seed_ + 1),
            "left": synth.tapping_hand(freq=4.3 - 0.4 * c + j(0.12), amp=0.8,
                                       decrement=0.05 + 0.1 * c, interval_cv=6 + 2 * c, seed=seed_ + 2),
        }})
        store.save_result(aid, "motor", m["features"], m["trace"])

        v = voice.analyze_wav(synth.voice_wav(f0=128 + j(2), pitch_sd_st=2.6 - 0.9 * c + j(0.15),
                                              mean_pause_ms=340 + 180 * c + j(25), seed=seed_ + 3))
        store.save_result(aid, "voice", v["features"], v["trace"])

        g = sensors.gait_analyze(synth.walking(cadence_spm=112 + j(1.5), interval_cv=2.5 + abs(j(0.4)),
                                               intensity=2.6 + j(0.1), seed=seed_ + 4))
        store.save_result(aid, "gait", g["features"], g["trace"])

        b = sensors.balance_analyze(synth.standing(sway=0.07 + abs(j(0.006)), seed=seed_ + 5))
        store.save_result(aid, "balance", b["features"], b["trace"])

        cg = cognitive.analyze(synth.cognitive(rt_median=285 + j(8), rt_cv=11 + abs(j(1)),
                                               max_span=7 if r.random() > 0.3 else 6, seed=seed_ + 6))
        store.save_result(aid, "cognitive", cg["features"], cg["trace"])
    return DEMO_PROFILE
