"""
Feature registry: the single source of truth for every feature NeuroMap computes.

Each entry says which domain a feature belongs to, how to display it, and which
direction counts as "worse". The baseline and scoring code, the timeline, and
Research Mode are all driven from this table, so if you add a feature in a lab
module, register it here too.

higher_is_worse:
    True  -> an increase relative to baseline counts as an adverse change
    False -> a decrease counts as adverse
    None  -> tracked and plotted, but not used in the domain score
"""

from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class Feature:
    key: str
    domain: str
    label: str
    unit: str
    higher_is_worse: bool | None
    description: str


DOMAINS = ["motor", "speech", "gait", "balance", "cognition"]

FEATURES: list[Feature] = [
    # ---------------- Motor Lab (camera finger tapping) ----------------
    Feature("motor_tap_frequency_hz", "motor", "Tap frequency", "Hz", False,
            "Taps per second (thumb-index opening/closing cycles)."),
    Feature("motor_interval_cv", "motor", "Rhythm variability", "%", True,
            "Coefficient of variation of inter-tap intervals. Higher = less regular rhythm."),
    Feature("motor_mean_amplitude", "motor", "Tap amplitude", "hand-lengths", False,
            "Mean peak thumb-index aperture, normalised by hand size."),
    Feature("motor_amplitude_decrement", "motor", "Amplitude decrement", "%/10 taps", True,
            "How much amplitude shrinks over the trial (sequence effect). Positive = shrinking."),
    Feature("motor_asymmetry", "motor", "Left/right asymmetry", "%", True,
            "Relative difference in tap frequency between hands."),

    # ---------------- Voice Lab ----------------
    Feature("speech_speech_ratio", "speech", "Speech-to-silence ratio", "", False,
            "Fraction of the recording that is voiced speech."),
    Feature("speech_pause_count_per_min", "speech", "Pauses per minute", "/min", True,
            "Number of silent gaps longer than 150 ms, per minute of recording."),
    Feature("speech_mean_pause_ms", "speech", "Mean pause length", "ms", True,
            "Average duration of silent gaps."),
    Feature("speech_f0_mean_hz", "speech", "Mean pitch", "Hz", None,
            "Mean fundamental frequency over voiced frames."),
    Feature("speech_f0_sd_semitones", "speech", "Pitch variability", "st", False,
            "Standard deviation of pitch in semitones. Reduced = more monotone."),
    Feature("speech_intensity_sd_db", "speech", "Loudness variability", "dB", False,
            "Standard deviation of frame loudness over voiced frames."),
    Feature("speech_reading_rate_wpm", "speech", "Reading pace", "words/min", None,
            "Fixed-passage word count divided by recording duration; descriptive, not part of the adverse score."),
    Feature("speech_pitch_step_median_st", "speech", "Pitch instability", "st/frame", True,
            "Median absolute pitch shift between adjacent voiced frames; a high value indicates a less steady pitch contour."),

    # ---------------- Gait Lab (phone IMU, walking) ----------------
    Feature("gait_cadence_spm", "gait", "Cadence", "steps/min", False,
            "Steps per minute."),
    Feature("gait_step_interval_cv", "gait", "Step-time variability", "%", True,
            "Coefficient of variation of step intervals."),
    Feature("gait_accel_rms", "gait", "Movement intensity", "m/s²", False,
            "RMS of gravity-removed acceleration magnitude."),
    Feature("gait_regularity", "gait", "Step regularity", "", False,
            "Autocorrelation peak at one step period (1 = perfectly periodic)."),

    # ---------------- Balance Lab (phone IMU, standing) ----------------
    Feature("balance_sway_rms", "balance", "Sway magnitude", "m/s²", True,
            "RMS of horizontal acceleration while standing still."),
    Feature("balance_jerk_rms", "balance", "Sway jerkiness", "m/s³", True,
            "RMS of the time-derivative of horizontal acceleration."),

    # ---------------- Cognitive Lab ----------------
    Feature("cog_rt_median_ms", "cognition", "Reaction time (median)", "ms", True,
            "Median simple reaction time over valid trials."),
    Feature("cog_rt_cv", "cognition", "Reaction-time variability", "%", True,
            "Coefficient of variation of reaction times."),
    Feature("cog_lapses", "cognition", "Lapses", "trials", True,
            "Valid trials slower than 500 ms."),
    Feature("cog_false_starts", "cognition", "False starts", "trials", True,
            "Responses before the stimulus appeared."),
    Feature("cog_max_span", "cognition", "Digit span", "digits", False,
            "Longest digit sequence recalled correctly."),
    Feature("cog_span_accuracy", "cognition", "Digit-span accuracy", "%", False,
            "Correct digit-span trials as a percentage of all span trials."),
]

BY_KEY = {f.key: f for f in FEATURES}


def as_json():
    return {"domains": DOMAINS, "features": [asdict(f) for f in FEATURES]}
