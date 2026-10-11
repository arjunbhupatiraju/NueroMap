"""
Gait Lab and Balance Lab: phone inertial sensors (DeviceMotion API).

    raw = {
      "t":   [ms, ...],                 # performance.now() timestamps
      "acc": [[x, y, z], ...],          # accelerationIncludingGravity, m/s^2
      "gyro": [[alpha, beta, gamma], ...]   # rotationRate, deg/s (optional)
    }

Gait: user walks normally for ~30 s holding the phone against their chest (or in a front pocket).
Balance: user stands still, feet together, phone held against the chest, for ~20 s.

The phone can be in any orientation, so we estimate gravity with a low-pass filter
and project onto it. That gives an orientation-independent "vertical" axis.
"""

import numpy as np
from scipy.signal import butter, filtfilt, find_peaks

FS = 50.0
TRIM_S = 2.0   # drop the start/end where the user is pressing buttons / pocketing the phone


def _resample(raw: dict) -> tuple[np.ndarray, np.ndarray]:
    t = (np.asarray(raw["t"], dtype=float) - raw["t"][0]) / 1000.0
    acc = np.asarray(raw["acc"], dtype=float)
    ok = np.all(np.isfinite(acc), axis=1)
    t, acc = t[ok], acc[ok]
    order = np.argsort(t)
    t, acc = t[order], acc[order]
    t_u = np.arange(0, t[-1], 1 / FS)
    acc_u = np.column_stack([np.interp(t_u, t, acc[:, k]) for k in range(3)])
    lo, hi = int(TRIM_S * FS), len(t_u) - int(TRIM_S * FS)
    if hi - lo < FS * 5:
        raise ValueError("Recording too short: need at least ~9 seconds of sensor data.")
    return t_u[lo:hi] - t_u[lo], acc_u[lo:hi]


def _filt(x, kind, cutoff):
    b, a = butter(2, np.asarray(cutoff) / (FS / 2), btype=kind)
    return filtfilt(b, a, x, axis=0)


def _decompose(acc: np.ndarray):
    """Split into gravity, vertical linear acceleration (scalar), horizontal linear (vector)."""
    gravity = _filt(acc, "low", 0.3)
    g_norm = np.linalg.norm(gravity, axis=1, keepdims=True)
    if np.median(g_norm) < 5:
        raise ValueError("No gravity signal detected; this device may not report accelerationIncludingGravity.")
    g_unit = gravity / g_norm
    lin = acc - gravity
    vert = np.sum(lin * g_unit, axis=1)
    horiz = lin - vert[:, None] * g_unit
    return lin, vert, horiz


def gait_analyze(raw: dict) -> dict:
    t, acc = _resample(raw)
    lin, vert, _ = _decompose(acc)
    v = _filt(vert, "band", [0.5, 3.0])

    peaks, _ = find_peaks(v, distance=int(0.3 * FS), prominence=0.5 * np.std(v))
    if len(peaks) < 6:
        raise ValueError(f"Only {len(peaks)} steps detected. Walk for the full time at a normal pace.")
    intervals = np.diff(t[peaks])
    # Reject obvious detection errors (pauses/turns) before computing variability
    med = np.median(intervals)
    good = intervals[(intervals > 0.5 * med) & (intervals < 1.5 * med)]

    # Regularity: normalised autocorrelation peak around one step period
    vc = v - v.mean()
    ac = np.correlate(vc, vc, mode="full")[len(vc) - 1:]
    ac = ac / ac[0]
    lo, hi = int(0.6 * med * FS), int(1.4 * med * FS)
    regularity = float(np.max(ac[lo:hi])) if hi > lo else float("nan")

    features = {
        "gait_cadence_spm": float(60.0 / np.mean(good)),
        "gait_step_interval_cv": float(np.std(good, ddof=1) / np.mean(good) * 100),
        "gait_accel_rms": float(np.sqrt(np.mean(np.sum(lin ** 2, axis=1)))),
        "gait_regularity": regularity,
    }
    step = max(1, len(t) // 800)
    trace = {
        "t_s": np.round(t[::step], 3).tolist(),
        "raw_mag": np.round(np.linalg.norm(acc, axis=1)[::step], 3).tolist(),
        "vertical": np.round(v[::step], 3).tolist(),
        "step_t_s": np.round(t[peaks], 3).tolist(),
        "step_amp": np.round(v[peaks], 3).tolist(),
        "intervals_ms": np.round(intervals * 1000, 1).tolist(),
        "autocorr_lag_s": np.round(np.arange(min(len(ac), int(3 * FS))) / FS, 3).tolist(),
        "autocorr": np.round(ac[: int(3 * FS)], 3).tolist(),
        "step_count": int(len(peaks)),
    }
    return {"features": features, "trace": trace}


def balance_analyze(raw: dict) -> dict:
    t, acc = _resample(raw)
    _, _, horiz = _decompose(acc)
    h = _filt(horiz, "band", [0.1, 5.0])
    mag = np.linalg.norm(h, axis=1)
    jerk = np.diff(h, axis=0) * FS
    features = {
        "balance_sway_rms": float(np.sqrt(np.mean(mag ** 2))),
        "balance_jerk_rms": float(np.sqrt(np.mean(np.sum(jerk ** 2, axis=1)))),
    }
    # 2-D sway path in the horizontal plane (first two principal axes) for the Research view
    hc = h - h.mean(axis=0)
    _, _, vt = np.linalg.svd(hc, full_matrices=False)
    xy = hc @ vt[:2].T
    step = max(1, len(t) // 600)
    trace = {
        "t_s": np.round(t[::step], 3).tolist(),
        "sway_mag": np.round(mag[::step], 4).tolist(),
        "sway_x": np.round(xy[::step, 0], 4).tolist(),
        "sway_y": np.round(xy[::step, 1], 4).tolist(),
    }
    return {"features": features, "trace": trace}
