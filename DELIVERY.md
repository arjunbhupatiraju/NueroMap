# NeuroMap Delivery

## Code

### Backend
- [API](backend/neuromap/api.py)
- [Baseline scoring](backend/neuromap/baseline.py)
- [Demo profile](backend/neuromap/demo.py)
- [Feature registry](backend/neuromap/registry.py)
- [Data store](backend/neuromap/store.py)
- [Synthetic signals](backend/neuromap/synth.py)
- [Cognitive pipeline](backend/neuromap/labs/cognitive.py)
- [Motor pipeline](backend/neuromap/labs/motor.py)
- [Sensor pipelines](backend/neuromap/labs/sensors.py)
- [Voice pipeline](backend/neuromap/labs/voice.py)
- [Backend tests](backend/tests/test_pipelines.py)
- [Python dependencies](backend/requirements.txt)

### Frontend
- [Application shell](frontend/src/App.jsx)
- [Entry point](frontend/src/main.jsx)
- [Styles](frontend/src/styles.css)
- [Dashboard](frontend/src/pages/Dashboard.jsx)
- [Assessment](frontend/src/pages/Assessment.jsx)
- [Timeline](frontend/src/pages/Timeline.jsx)
- [Research](frontend/src/pages/Research.jsx)
- [Report](frontend/src/pages/Report.jsx)
- [Motor lab](frontend/src/labs/MotorLab.jsx)
- [Voice lab](frontend/src/labs/VoiceLab.jsx)
- [Cognitive lab](frontend/src/labs/CognitiveLab.jsx)
- [Sensor lab](frontend/src/labs/SensorLab.jsx)
- [NeuroMap visualization](frontend/src/components/NeuroMapViz.jsx)
- [Feature table](frontend/src/components/FeatureTable.jsx)
- [Logo](frontend/src/components/Logo.jsx)
- [API client](frontend/src/lib/api.js)
- [Formatting helpers](frontend/src/lib/fmt.js)
- [Countdown hook](frontend/src/lib/useCountdown.js)
- [WAV utilities](frontend/src/lib/wav.js)
- [HTML entry](frontend/index.html)
- [Frontend dependencies](frontend/package.json)
- [Vite configuration](frontend/vite.config.js)

- [Project overview and setup](README.md)

## App to Run

**Open the running app:** [http://localhost:5173/](http://localhost:5173/)

To start it locally, run the backend and frontend in separate terminals:

```sh
cd backend
uvicorn neuromap.api:app --reload --port 8000
```

```sh
cd frontend
npm install
npm run dev
```
