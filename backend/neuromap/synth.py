"""
Synthetic raw-data generators.

Used for two things:
  1. Tests: signals with known ground truth (e.g. "tapping at exactly 4 Hz") so we can
     check every pipeline recovers the right answer.
  2. The demo profile: 10 weekly sessions of raw data run through the REAL pipelines,
     with a gradual change injected partway through, so the dashboard, timeline and
     Research Mode can be shown without collecting months of real data.

Everything here is clearly synthetic and is labelled that way in the app.
"""

import io

import numpy as np
from scipy.io import wavfile


def _rng(seed):
    return np.random.default_rng(seed)


# ------------------------------------------------------------------ motor
def tapping_hand(freq=4.0, amp=0.8, decrement=0.0, interval_cv=5.0, duration=10.0,
                 fps=30.0, pixel_noise=1.0, seed=0) -> dict:
    """decrement: fraction of amplitude lost by the end of the trial (0.2 = 20%)."""
    r = _rng(seed)
    n_taps = int(duration * freq) + 3
    periods = np.clip(r.normal(1 / freq, interval_cv / 100 / freq, n_taps), 0.3 / freq, None)
    edges = np.concatenate([[0], np.cumsum(periods)])
    t = np.cumsum(np.clip(r.normal(1 / fps, 0.15 / fps, int(duration * fps)), 0.3 / fps, None))
    t = t - t[0]
    cycle = np.interp(t, edges, np.arange(len(edges)))
    phase = 2 * np.pi * cycle
    a = amp * (1 - decrement * t / duration)
    ap = 0.05 + a * (0.5 - 0.5 * np.cos(phase))       # 0.05 = fingertips never perfectly overlap
    hand_px = 100.0
    wrist = np.column_stack([np.full_like(t, 320), np.full_like(t, 400)])
    mcp = wrist + [0, -hand_px]
    thumb = np.column_stack([np.full_like(t, 260), np.full_like(t, 260)])
    index = thumb + np.column_stack([np.zeros_like(t), -ap * hand_px])
    noise = lambda: r.normal(0, pixel_noise, (len(t), 2))  # noqa: E731
    return {
        "t": (t * 1000).tolist(),
        "thumb": (thumb + noise()).tolist(),
        "index": (index + noise()).tolist(),
        "wrist": (wrist + noise()).tolist(),
        "middle_mcp": (mcp + noise()).tolist(),
    }


# ------------------------------------------------------------------ sensors
def _random_rotation(r):
    q = r.normal(size=4)
    q /= np.linalg.norm(q)
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def walking(cadence_spm=110.0, interval_cv=2.0, intensity=2.5, duration=30.0, fs=60.0, seed=0) -> dict:
    r = _rng(seed)
    step = 60.0 / cadence_spm
    n = int(duration / step) + 3
    step_times = np.cumsum(np.clip(r.normal(step, interval_cv / 100 * step, n), 0.2, None))
    t = np.cumsum(np.clip(r.normal(1 / fs, 0.1 / fs, int(duration * fs)), 0.3 / fs, None))
    t -= t[0]
    cyc = np.interp(t, np.concatenate([[0], step_times]), np.arange(n + 1))
    vert = intensity * np.cos(2 * np.pi * cyc) + r.normal(0, 0.3, len(t))
    fwd = 0.5 * intensity * np.sin(2 * np.pi * cyc) + r.normal(0, 0.3, len(t))
    side = 0.3 * intensity * np.sin(np.pi * cyc) + r.normal(0, 0.2, len(t))
    world = np.column_stack([fwd, side, 9.81 + vert])
    R = _random_rotation(r)
    acc = world @ R.T
    return {"t": (t * 1000).tolist(), "acc": acc.tolist()}


def standing(sway=0.08, duration=20.0, fs=60.0, seed=0) -> dict:
    r = _rng(seed)
    n = int(duration * fs)
    t = np.arange(n) / fs
    # Low-frequency sway: filtered noise
    from scipy.signal import butter, filtfilt
    b, a = butter(2, 1.5 / (fs / 2))
    h = filtfilt(b, a, r.normal(0, 1, (n, 2)), axis=0)
    h = h / h.std() * sway
    world = np.column_stack([h, 9.81 + r.normal(0, 0.02, n)])
    acc = world @ _random_rotation(r).T
    return {"t": (t * 1000).tolist(), "acc": acc.tolist()}


# ------------------------------------------------------------------ voice
def voice_wav(f0=120.0, pitch_sd_st=2.5, mean_pause_ms=350.0, duration=20.0, sr=16000, seed=0) -> bytes:
    r = _rng(seed)
    n = int(duration * sr)
    t = np.arange(n) / sr
    # Speech / pause layout
    env = np.zeros(n)
    pos = 0.5
    while pos < duration - 0.5:
        phrase = r.uniform(1.5, 3.0)
        end = min(pos + phrase, duration - 0.3)
        m = (t >= pos) & (t < end)
        tt = t[m] - pos
        # syllable-rate modulation ~4 Hz, never fully silent inside a phrase
        env[m] = 0.55 + 0.45 * np.abs(np.sin(np.pi * 4.0 * tt))
        pos = end + max(0.16, r.normal(mean_pause_ms / 1000, 0.25 * mean_pause_ms / 1000))
    # Smooth pitch contour in semitones
    knots = np.linspace(0, duration, int(duration * 3) + 2)
    st = np.interp(t, knots, r.normal(0, pitch_sd_st, len(knots)))
    f = f0 * 2 ** (st / 12)
    phase = 2 * np.pi * np.cumsum(f) / sr
    voice = sum(np.sin(k * phase) / k for k in range(1, 11))
    x = voice * env * (0.6 + 0.4 * np.interp(t, knots, r.uniform(0.5, 1.0, len(knots))))
    x = x + r.normal(0, 0.002, n)
    x = x / np.max(np.abs(x)) * 0.8
    buf = io.BytesIO()
    wavfile.write(buf, sr, (x * 32767).astype(np.int16))
    return buf.getvalue()


# ------------------------------------------------------------------ cognition
def cognitive(rt_median=280.0, rt_cv=12.0, false_starts=0, max_span=7, n=20, seed=0) -> dict:
    r = _rng(seed)
    sigma = np.sqrt(np.log(1 + (rt_cv / 100) ** 2))
    rts = rt_median * np.exp(r.normal(0, sigma, n))
    trials = []
    t = 1000.0
    for i, rt in enumerate(rts):
        t += r.uniform(1500, 3500)
        trials.append({"stimulus_ms": t, "response_ms": t + rt, "false_start": i < false_starts})
        t += rt
    span = [{"length": L, "correct": L <= max_span} for L in range(3, max_span + 2)]
    return {"reaction": trials, "span": span}
