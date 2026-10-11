# NeuroMap

People often notice neurological change too late, and routine checkups compare you to population averages instead of to your own normal. NeuroMap helps close that gap by turning movement, speech, gait, balance, and reaction-time signals into a personal baseline and longitudinal trend map.

A computational neuroscience lab that runs on a phone and a laptop. NeuroMap records five kinds of
behavioral signal, turns each into interpretable features, learns what is normal for *you*,
and tracks how your profile changes over time.

> NeuroMap measures change relative to your own baseline. It is a personal experiment, not a
> medical device, and it does not diagnose anything.

```
 CAMERA            MICROPHONE          SCREEN            PHONE IMU
 hand landmarks    16 kHz audio        RT + span         accel + gyro
      │                 │                  │                  │
 aperture signal   loudness / VAD      RT distribution    gravity removal
 tap detection     pitch tracking      span staircase     step / sway
      │                 │                  │                  │
      └──────── FEATURES (22, see backend/neuromap/registry.py) ─┘
                               │
                PERSONAL BASELINE (median / MAD of first sessions)
                               │
                    robust z-scores → domain scores (0–100)
                               │
          NEUROMAP · TIMELINE · RESEARCH MODE (every pipeline stage plotted)
```

## Running it

You need Python 3.10+ and Node 18+.

```bash
# 1. backend
cd backend
pip install -r requirements.txt
uvicorn neuromap.api:app --reload --port 8000

# 2. frontend (second terminal)
cd frontend
npm install
npm run dev            # http://localhost:5173
```

The downloadable project includes a preloaded **Demo (synthetic)** profile with a full 10-week
history, so a fresh install opens directly to the map. Click **Load synthetic demo profile** to
regenerate that clean demo; its raw signals are run through the real pipelines.
## Screenshots

![NeuroMap overview](screenshots/map.png)
![Research mode](screenshots/research.png)
![Timeline view](screenshots/timeline.png)
### On your phone (for the Gait and Balance labs)

Phones only allow camera, microphone and motion sensors over HTTPS, so:

```bash
cd frontend
npm run phone          # serves https://<your-laptop-LAN-ip>:5173 with a self-signed cert
```

Open that address on your phone (same Wi-Fi), accept the certificate warning, and use the same
profile name. On iPhone, Safari asks for motion permission when you tap Start.

### Single process (after building)

```bash
cd frontend && npm run build
cd ../backend && uvicorn neuromap.api:app --host 0.0.0.0 --port 8000
```

The backend serves the built frontend at `/`.

## The labs

| Lab | Input | Pipeline | Features |
|---|---|---|---|
| Motor | MediaPipe hand landmarks, 10 s per hand | thumb–index distance ÷ hand size → 60 Hz resample → peak detection | tap frequency, rhythm CV, amplitude, amplitude decrement, L/R asymmetry |
| Voice | Standard read-aloud passage, 16 kHz WAV | 25 ms frames → dB envelope → adaptive VAD → autocorrelation F0 | reading pace (81-word passage / duration), speech ratio, pauses/min, mean pause, F0 mean/variation/instability, loudness SD |
| Cognitive | 15 reaction trials + digit span | RT = t_response − t_stimulus, MAD outlier trim, span staircase | median RT, RT CV, lapses, false starts, max span, span accuracy |
| Gait | Phone IMU while walking 30 s | low-pass gravity estimate → project onto vertical → 0.5–3 Hz band-pass → step peaks, autocorrelation | cadence, step-time CV, intensity, regularity |
| Balance | Phone IMU standing still 20 s | gravity removal → horizontal component → 0.1–5 Hz | sway RMS, jerk RMS |

Only landmarks, features and small plot traces are stored. No video or audio is kept.

## Baseline and scoring (`backend/neuromap/baseline.py`)

- The first 6 sessions form the reference period. Scores appear after 3.
- Per feature: `z = (x − median) / (1.4826 · MAD)`, with the spread floored at 5% of the median.
- Each feature has a direction (`higher_is_worse` in the registry). A domain score is
  `100 − 15 × mean(adverse z, clipped to [0, 5])`.
- A feature is flagged past 2 SD, and marked **sustained** after 3 consecutive sessions past 1.5 SD.
- The change index is the RMS of all z-scores: ‖P(t) − P(baseline)‖.

## Dashboard intelligence

- Each NeuroMap node opens its domain score, recent trend, leading adverse feature shifts,
  baseline session count, consistency estimate, and recent score history. The same summary is
  available for all five domains below the map.
- Feature importance is the share of positive adverse z-scores for that domain in the latest
  assessment. It describes current baseline deviations; it is not a causal or model-based
  importance measure.
- Change points use a one-split comparison of domain-score levels. The dashboard requires at
  least five scored sessions, an 8-point level difference, and a 50% fit improvement before it
  flags a possible change. This is exploratory detection, not a statistical significance test.
- Baseline confidence reflects how many of the first six sessions contain measurements for that
  domain. The consistency percentage is an exploratory estimate from recent feature variation;
  it is not test-retest reliability or a clinically validated score.
- Correlation networks, digital-twin forecasts, assessment quality checks, tremor detection,
  gait symmetry, and balance coordination are not included yet.

## Project layout

```
backend/
  neuromap/
    registry.py      every feature: domain, label, unit, direction
    labs/            motor.py  voice.py  sensors.py  cognitive.py
    baseline.py      personal baseline, z-scores, domain scores
    synth.py         synthetic signal generators (tests + demo)
    demo.py          10-week demo profile with an injected motor/speech change
    store.py         SQLite
    api.py           FastAPI
  tests/             pipelines must recover known ground truth from synthetic signals
frontend/src/
  labs/              capture UIs (camera, mic, sensors, cognitive tasks)
  pages/             Dashboard, Assessment, Timeline, Research, Report
  components/        NeuroMapViz, FeatureTable
```

Run the tests with `cd backend && python -m pytest -q`.

## Ideas for next steps

- **Test–retest reliability:** do 5 sessions over a week and compute ICC per feature. This
  tells you which features are stable enough to track.
- **Multimodal ablation:** on a paired public dataset (e.g. Sage Bionetworks mPower, which
  requires a data-access application), compare voice-only, motor-only and fused models.
- **Change-point validation:** compare the exploratory domain-level split against a validated
  sequential method on longer, labeled histories.
