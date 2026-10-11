"""
Voice Lab: read-aloud passage.

The browser records the user reading the same standard passage every time,
converts it to 16 kHz mono and uploads a 16-bit WAV. We never transcribe it:
we measure the physical signal.

Pipeline:
    waveform -> 25 ms frames -> loudness (dB) -> voice activity detection
             -> pauses + speech ratio
             -> autocorrelation pitch tracking on voiced frames -> F0 stats
"""

import io

import numpy as np
from scipy.io import wavfile
from scipy.signal import medfilt

FRAME_S = 0.025
HOP_S = 0.010
MIN_PAUSE_S = 0.150
F0_MIN, F0_MAX = 70.0, 400.0
PITCH_WIN_S = 0.040
STANDARD_PASSAGE_WORDS = 81


def load_wav(data: bytes) -> tuple[np.ndarray, int]:
    sr, x = wavfile.read(io.BytesIO(data))
    x = x.astype(float)
    if x.ndim > 1:
        x = x.mean(axis=1)
    peak = np.max(np.abs(x)) or 1.0
    return x / peak, int(sr)


def frame_signal(x: np.ndarray, sr: int, frame_s: float, hop_s: float) -> np.ndarray:
    n = int(round(frame_s * sr))
    h = int(round(hop_s * sr))
    if len(x) < n:
        x = np.pad(x, (0, n - len(x)))
    count = 1 + (len(x) - n) // h
    idx = np.arange(n)[None, :] + h * np.arange(count)[:, None]
    return x[idx]


def loudness_db(frames: np.ndarray) -> np.ndarray:
    rms = np.sqrt(np.mean(frames ** 2, axis=1))
    return 20 * np.log10(rms + 1e-8)


def voice_activity(db: np.ndarray) -> np.ndarray:
    """Adaptive threshold: 12 dB above the noise floor, and within 45 dB of the loudest frame."""
    floor = np.percentile(db, 10)
    thresh = max(floor + 12.0, db.max() - 45.0)
    active = db > thresh
    # Close tiny gaps (< 50 ms) and remove tiny blips (< 50 ms) so consonants don't split words
    k = int(round(0.05 / HOP_S)) | 1
    active = medfilt(active.astype(float), k) > 0.5
    return active


def runs(mask: np.ndarray, value: bool) -> list[tuple[int, int]]:
    """[start, end) index pairs of consecutive runs equal to value."""
    m = np.concatenate([[0], (mask == value).astype(int), [0]])
    d = np.diff(m)
    starts = np.where(d == 1)[0]
    ends = np.where(d == -1)[0]
    return list(zip(starts.tolist(), ends.tolist()))


def pitch_track(x: np.ndarray, sr: int, voiced: np.ndarray) -> np.ndarray:
    """Normalised-autocorrelation F0 per hop; NaN where unvoiced or unreliable."""
    frames = frame_signal(x, sr, PITCH_WIN_S, HOP_S)
    n_frames = min(len(frames), len(voiced))
    lag_min = int(sr / F0_MAX)
    lag_max = int(sr / F0_MIN)
    f0 = np.full(n_frames, np.nan)
    win = np.hanning(frames.shape[1])
    for i in range(n_frames):
        if not voiced[i]:
            continue
        fr = (frames[i] - frames[i].mean()) * win
        spec = np.fft.rfft(fr, n=2 * len(fr))
        ac = np.fft.irfft(spec * np.conj(spec))[: len(fr)]
        if ac[0] <= 0:
            continue
        ac = ac / ac[0]
        seg = ac[lag_min:lag_max]
        if len(seg) == 0:
            continue
        j = int(np.argmax(seg))
        if seg[j] < 0.45:
            continue
        lag = j + lag_min
        # parabolic interpolation for sub-sample lag
        if 0 < lag < len(ac) - 1:
            a, b, c = ac[lag - 1], ac[lag], ac[lag + 1]
            denom = a - 2 * b + c
            if denom != 0:
                lag = lag + float(np.clip(0.5 * (a - c) / denom, -0.5, 0.5))
        f0[i] = sr / lag
    # Octave-jump cleanup: drop values more than ~7 semitones from the running median
    good = ~np.isnan(f0)
    if good.sum() > 5:
        med = np.nanmedian(f0)
        st = 12 * np.log2(f0 / med)
        f0[np.abs(st) > 7] = np.nan
    return f0


def analyze_wav(data: bytes, passage_words: int = STANDARD_PASSAGE_WORDS) -> dict:
    x, sr = load_wav(data)
    duration = len(x) / sr
    if duration < 3:
        raise ValueError("Recording is shorter than 3 seconds.")

    frames = frame_signal(x, sr, FRAME_S, HOP_S)
    db = loudness_db(frames)
    voiced = voice_activity(db)
    speech_runs = runs(voiced, True)
    if not speech_runs:
        raise ValueError("No speech detected. Check the microphone and read the passage aloud.")

    first, last = speech_runs[0][0], speech_runs[-1][1]
    span_s = (last - first) * HOP_S
    silent = runs(voiced[first:last], False)
    pauses = [((s + first) * HOP_S, (e + first) * HOP_S) for s, e in silent
              if (e - s) * HOP_S >= MIN_PAUSE_S]
    pause_lengths = [e - s for s, e in pauses]

    f0 = pitch_track(x, sr, voiced)
    f0_valid = f0[~np.isnan(f0)]
    if len(f0_valid) < 20:
        raise ValueError("Could not track pitch reliably; try a quieter room.")
    f0_med = float(np.median(f0_valid))
    semis = 12 * np.log2(f0_valid / f0_med)
    adjacent_voiced = np.isfinite(f0[:-1]) & np.isfinite(f0[1:])
    pitch_steps = 12 * np.log2(f0[1:][adjacent_voiced] / f0[:-1][adjacent_voiced])

    features = {
        "speech_speech_ratio": float(voiced[first:last].mean()),
        "speech_pause_count_per_min": len(pauses) / (span_s / 60.0),
        "speech_mean_pause_ms": float(np.mean(pause_lengths) * 1000) if pause_lengths else 0.0,
        "speech_f0_mean_hz": float(np.mean(f0_valid)),
        "speech_f0_sd_semitones": float(np.std(semis)),
        "speech_intensity_sd_db": float(np.std(db[voiced])),
        "speech_pitch_step_median_st": float(np.median(np.abs(pitch_steps))) if len(pitch_steps) else 0.0,
        "speech_reading_rate_wpm": float(passage_words / duration * 60.0),
    }

    step = max(1, len(db) // 800)
    t = np.arange(len(db)) * HOP_S
    trace = {
        "duration_s": round(duration, 2),
        "t_s": np.round(t[::step], 3).tolist(),
        "db": np.round(db[::step], 1).tolist(),
        "voiced": voiced[::step].astype(int).tolist(),
        "f0_t_s": np.round(t[: len(f0)][::step], 3).tolist(),
        "f0_hz": [None if np.isnan(v) else round(float(v), 1) for v in f0[::step]],
        "pauses": [[round(s, 3), round(e, 3)] for s, e in pauses],
    }
    return {"features": features, "trace": trace}
