"""
Motor Lab: camera finger tapping.

The browser runs MediaPipe Hand Landmarker on the webcam while the user taps
thumb and index finger together as fast and as wide as possible for 10 s per hand.
Instead of video, it sends landmark coordinates over time:

    raw = {
      "hands": {
        "right": {
          "t":          [0.0, 33.1, 66.4, ...],   # ms, performance.now(), uneven spacing
          "thumb":      [[x, y], ...],             # landmark 4  (THUMB_TIP), pixels
          "index":      [[x, y], ...],             # landmark 8  (INDEX_FINGER_TIP)
          "wrist":      [[x, y], ...],             # landmark 0
          "middle_mcp": [[x, y], ...],             # landmark 9  (base of middle finger)
        },
        "left": { ...same shape... }               # optional
      }
    }

Pipeline (what Research Mode shows):

    landmarks -> aperture signal -> uniform resample -> tap detection -> features
"""

import numpy as np
from scipy.signal import find_peaks

RESAMPLE_HZ = 60.0
MAX_TAP_HZ = 10.0
MIN_RANGE = 0.08   # hand-lengths; smaller movement than this is landmark jitter


def _dist(a, b) -> np.ndarray:
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    return np.linalg.norm(a[:, :2] - b[:, :2], axis=1)


def aperture_signal(thumb, index, wrist, middle_mcp) -> np.ndarray:
    """Thumb-index distance per frame, normalised by hand size (wrist -> middle MCP)."""
    hand = _dist(wrist, middle_mcp)
    hand = np.where(hand < 1e-6, np.nan, hand)
    ap = _dist(thumb, index) / hand
    # Fill any NaNs (degenerate frames) by interpolation
    if np.isnan(ap).any():
        idx = np.arange(len(ap))
        ok = ~np.isnan(ap)
        ap = np.interp(idx, idx[ok], ap[ok])
    return ap


def resample_uniform(t_ms, x, fs: float = RESAMPLE_HZ) -> tuple[np.ndarray, np.ndarray]:
    """Linear interpolation of unevenly timed samples onto an even grid at fs Hz."""
    t = (np.asarray(t_ms, dtype=float) - float(t_ms[0])) / 1000.0
    order = np.argsort(t)
    t, x = t[order], np.asarray(x, dtype=float)[order]
    t_u = np.arange(0.0, t[-1], 1.0 / fs)
    return t_u, np.interp(t_u, t, x)


def smooth(x: np.ndarray, k: int = 3) -> np.ndarray:
    if k <= 1 or len(x) < k:
        return x
    return np.convolve(x, np.ones(k) / k, mode="same")


def detect_taps(x: np.ndarray, fs: float = RESAMPLE_HZ) -> np.ndarray:
    """Indices of aperture peaks (fingers fully open), one per tap cycle."""
    xs = smooth(x, 3)
    rng = np.percentile(xs, 95) - np.percentile(xs, 5)
    if rng < MIN_RANGE:
        return np.array([], dtype=int)   # fingers barely moved: jitter only, no taps
    peaks, _ = find_peaks(
        xs,
        distance=max(1, int(fs / MAX_TAP_HZ)),
        prominence=max(0.25 * rng, 0.5 * MIN_RANGE),
    )
    return peaks


def hand_features(t_ms, thumb, index, wrist, middle_mcp) -> tuple[dict, dict]:
    ap = aperture_signal(thumb, index, wrist, middle_mcp)
    t_u, x_u = resample_uniform(t_ms, ap)
    peaks = detect_taps(x_u)
    if len(peaks) < 4:
        raise ValueError(f"Only {len(peaks)} taps detected; need at least 4. "
                         "Keep your whole hand in frame and tap with big movements.")

    pt = t_u[peaks]
    pa = x_u[peaks]
    intervals = np.diff(pt)
    freq = (len(peaks) - 1) / (pt[-1] - pt[0])
    mean_amp = float(np.mean(pa))
    slope = np.polyfit(np.arange(len(pa)), pa, 1)[0]
    decrement = float(-slope * 10 / mean_amp * 100)

    feats = {
        "tap_frequency_hz": float(freq),
        "interval_cv": float(np.std(intervals, ddof=1) / np.mean(intervals) * 100),
        "mean_amplitude": mean_amp,
        "amplitude_decrement": decrement,
        "tap_count": int(len(peaks)),
    }
    step = max(1, len(t_u) // 600)
    trace = {
        "t_s": np.round(t_u[::step], 3).tolist(),
        "aperture": np.round(x_u[::step], 4).tolist(),
        "peak_t_s": np.round(pt, 3).tolist(),
        "peak_amp": np.round(pa, 4).tolist(),
        "intervals_ms": np.round(intervals * 1000, 1).tolist(),
        "tap_count": int(len(peaks)),
    }
    return feats, trace


def analyze(raw: dict) -> dict:
    hands = raw.get("hands") or {}
    results = {}
    for side in ("right", "left"):
        h = hands.get(side)
        if h and len(h.get("t", [])) > 30:
            results[side] = hand_features(h["t"], h["thumb"], h["index"], h["wrist"], h["middle_mcp"])
    if not results:
        raise ValueError("No usable hand recording (need at least ~1 s of tracked frames).")

    primary = results.get("right") or results.get("left")
    f = primary[0]
    features = {
        "motor_tap_frequency_hz": f["tap_frequency_hz"],
        "motor_interval_cv": f["interval_cv"],
        "motor_mean_amplitude": f["mean_amplitude"],
        "motor_amplitude_decrement": f["amplitude_decrement"],
    }
    if "right" in results and "left" in results:
        fr = results["right"][0]["tap_frequency_hz"]
        fl = results["left"][0]["tap_frequency_hz"]
        features["motor_asymmetry"] = abs(fr - fl) / ((fr + fl) / 2) * 100

    trace = {side: {**tr, "features": feats} for side, (feats, tr) in results.items()}
    return {"features": features, "trace": trace}
