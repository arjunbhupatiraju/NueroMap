"""Every pipeline must recover known ground truth from synthetic signals."""

import os
import tempfile

import pytest

os.environ["NEUROMAP_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")

from neuromap import baseline, synth  # noqa: E402
from neuromap.labs import cognitive, motor, sensors, voice  # noqa: E402


@pytest.mark.parametrize("freq", [2.5, 4.0, 6.0])
def test_motor_frequency(freq):
    f = motor.analyze({"hands": {"right": synth.tapping_hand(freq=freq, seed=int(freq * 10))}})["features"]
    assert f["motor_tap_frequency_hz"] == pytest.approx(freq, rel=0.05)


def test_motor_decrement_and_asymmetry():
    f = motor.analyze({"hands": {
        "right": synth.tapping_hand(freq=4.0, decrement=0.3, seed=1),
        "left": synth.tapping_hand(freq=3.0, decrement=0.0, seed=2),
    }})["features"]
    # 30% lost over 40 taps -> ~7.5% per 10 taps (relative to mean amplitude, so a bit higher)
    assert 5 < f["motor_amplitude_decrement"] < 12
    assert f["motor_asymmetry"] == pytest.approx(100 * 1 / 3.5, rel=0.1)


def test_motor_rhythm_variability_orders():
    steady = motor.analyze({"hands": {"right": synth.tapping_hand(interval_cv=3, seed=5)}})["features"]
    shaky = motor.analyze({"hands": {"right": synth.tapping_hand(interval_cv=15, seed=5)}})["features"]
    assert shaky["motor_interval_cv"] > steady["motor_interval_cv"] * 2


def test_motor_rejects_no_taps():
    h = synth.tapping_hand(amp=0.0)
    with pytest.raises(ValueError):
        motor.analyze({"hands": {"right": h}})


@pytest.mark.parametrize("f0", [100.0, 180.0, 240.0])
def test_voice_pitch(f0):
    f = voice.analyze_wav(synth.voice_wav(f0=f0, pitch_sd_st=0.5, seed=int(f0)))["features"]
    assert f["speech_f0_mean_hz"] == pytest.approx(f0, rel=0.05)


def test_voice_pauses_and_monotone():
    a = voice.analyze_wav(synth.voice_wav(pitch_sd_st=3.0, mean_pause_ms=300, seed=1))["features"]
    b = voice.analyze_wav(synth.voice_wav(pitch_sd_st=0.8, mean_pause_ms=700, seed=1))["features"]
    assert b["speech_mean_pause_ms"] > a["speech_mean_pause_ms"] + 200
    assert b["speech_f0_sd_semitones"] < a["speech_f0_sd_semitones"] / 2


def test_voice_reading_pace_and_pitch_stability():
    result = voice.analyze_wav(synth.voice_wav(duration=10, seed=31), passage_words=81)
    assert result["features"]["speech_reading_rate_wpm"] == pytest.approx(486)
    assert result["features"]["speech_pitch_step_median_st"] >= 0


@pytest.mark.parametrize("cadence", [90.0, 110.0, 130.0])
def test_gait_cadence_any_orientation(cadence):
    f = sensors.gait_analyze(synth.walking(cadence_spm=cadence, seed=int(cadence)))["features"]
    assert f["gait_cadence_spm"] == pytest.approx(cadence, rel=0.04)
    assert f["gait_regularity"] > 0.7


def test_balance_orders():
    calm = sensors.balance_analyze(synth.standing(sway=0.05, seed=1))["features"]
    wobbly = sensors.balance_analyze(synth.standing(sway=0.25, seed=1))["features"]
    assert wobbly["balance_sway_rms"] > 3 * calm["balance_sway_rms"]


def test_cognitive():
    f = cognitive.analyze(synth.cognitive(rt_median=300, false_starts=2, max_span=6))["features"]
    assert f["cog_rt_median_ms"] == pytest.approx(300, rel=0.1)
    assert f["cog_false_starts"] == 2
    assert f["cog_max_span"] == 6
    assert f["cog_span_accuracy"] == pytest.approx(80)


def test_baseline_flags_adverse_change():
    hist = [{"motor_tap_frequency_hz": 4.5 + 0.05 * (i % 3)} for i in range(6)]
    hist.append({"motor_tap_frequency_hz": 3.5})
    scored, base = baseline.score_timeline([{"id": i, "features": f} for i, f in enumerate(hist)])
    assert scored[0]["calibrating"]
    assert scored[-1]["z"]["motor_tap_frequency_hz"] < -2
    assert "motor_tap_frequency_hz" in scored[-1]["flags"]
    assert scored[-1]["scores"]["motor"] < scored[4]["scores"]["motor"]


def test_api_end_to_end():
    from fastapi.testclient import TestClient
    from neuromap.api import app

    c = TestClient(app)
    aid = c.post("/api/assessments", json={"profile": "t"}).json()["id"]
    r = c.post(f"/api/assessments/{aid}/labs/motor", json={"hands": {"right": synth.tapping_hand()}})
    assert r.status_code == 200
    r = c.post(f"/api/assessments/{aid}/labs/voice", files={"file": ("a.wav", synth.voice_wav(), "audio/wav")})
    assert r.status_code == 200
    assert r.json()["features"]["speech_reading_rate_wpm"] > 0
    assert c.post(f"/api/assessments/{aid}/labs/motor", json={"hands": {}}).status_code == 422
    tl = c.get("/api/profiles/t/timeline").json()
    assert len(tl["assessments"]) == 1
    assert "change_points" in tl

    prof = c.post("/api/demo/seed").json()["profile"]
    tl = c.get(f"/api/profiles/{prof}/timeline").json()
    last = tl["assessments"][-1]
    assert last["scores"]["motor"] < 80          # injected change is visible
    assert last["scores"]["gait"] > 80           # untouched domain stays near baseline


def test_api_delete_assessment():
    from fastapi.testclient import TestClient
    from neuromap.api import app

    c = TestClient(app)
    aid = c.post("/api/assessments", json={"profile": "delete-test"}).json()["id"]
    assert c.delete(f"/api/assessments/{aid}").status_code == 200
    assert c.get(f"/api/assessments/{aid}").status_code == 404


def test_change_point_detection_marks_domain_shift():
    assessments = []
    for i in range(10):
        speech = 88.0
        gait = 92.0
        balance = 90.0
        cognition = 89.0
        features = {
            "motor_tap_frequency_hz": 4.5 if i < 7 else 3.5,
            "motor_interval_cv": 11.0,
            "motor_mean_amplitude": 1.0,
            "motor_amplitude_decrement": 6.0,
            "motor_asymmetry": 8.0,
            "speech_speech_ratio": 0.63,
            "speech_pause_count_per_min": 10.0,
            "speech_mean_pause_ms": 180.0,
            "speech_f0_sd_semitones": 1.2,
            "speech_intensity_sd_db": 4.5,
            "gait_cadence_spm": 118.0,
            "gait_step_interval_cv": 6.0,
            "gait_accel_rms": 1.1,
            "gait_regularity": 0.9,
            "balance_sway_rms": 0.18,
            "balance_jerk_rms": 0.12,
            "cog_rt_median_ms": 280.0,
            "cog_rt_cv": 18.0,
            "cog_lapses": 1,
            "cog_false_starts": 0,
            "cog_max_span": 6,
            "cog_span_accuracy": 90.0,
        }
        assessments.append({
            "id": i + 1,
            "created_at": f"2024-01-0{i + 1}T00:00:00Z",
            "features": features,
            "scores": {"motor": motor, "speech": speech, "gait": gait, "balance": balance, "cognition": cognition},
        })

    scored, _ = baseline.score_timeline(assessments)
    change_points = baseline.detect_change_points(scored)
    assert any(item["domain"] == "motor" for item in change_points)
    assert change_points[0]["delta"] < 0


def test_feature_importance_is_normalized():
    scores = {
        "motor_tap_frequency_hz": 1.8,
        "motor_interval_cv": 3.1,
        "motor_mean_amplitude": 1.0,
        "motor_asymmetry": 0.4,
    }
    weights = baseline.feature_importance(scores, "motor")
    assert sum(item["share"] for item in weights) == pytest.approx(1.0)
    assert weights[0]["key"] == "motor_interval_cv"
