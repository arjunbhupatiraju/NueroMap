"""
NeuroMap API.

    uvicorn neuromap.api:app --reload --port 8000

If frontend/dist exists (after `npm run build`), it is served at / as well, so the
whole app can run as one process.
"""

import os

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import baseline, demo, registry, store
from .labs import cognitive, motor, sensors, voice
from .research import voice_model

app = FastAPI(title="NeuroMap")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

JSON_LABS = {
    "motor": motor.analyze,
    "cognitive": cognitive.analyze,
    "gait": sensors.gait_analyze,
    "balance": sensors.balance_analyze,
}
LABS = ["motor", "voice", "cognitive", "gait", "balance"]


def _run(aid: int, lab: str, fn, arg):
    if not store.get_assessment(aid):
        raise HTTPException(404, "Assessment not found")
    try:
        out = fn(arg)
    except (ValueError, KeyError, IndexError) as e:
        raise HTTPException(422, str(e) if isinstance(e, ValueError) else f"Malformed {lab} data: {e}")
    features = {k: v for k, v in store.clean(out["features"]).items() if v is not None}
    trace = store.clean(out["trace"])
    store.save_result(aid, lab, features, trace)
    return {"features": features, "trace": trace}


@app.get("/api/registry")
def get_registry():
    return {**registry.as_json(), "labs": LABS}


@app.get("/api/profiles")
def profiles():
    return store.list_profiles()


@app.delete("/api/profiles/{profile}")
def remove_profile(profile: str):
    store.delete_profile(profile)
    return {"ok": True}


@app.post("/api/assessments")
def new_assessment(body: dict = Body(...)):
    profile = (body.get("profile") or "").strip()
    if not profile:
        raise HTTPException(400, "profile is required")
    return {"id": store.create_assessment(profile)}


@app.post("/api/assessments/{aid}/labs/voice")
async def submit_voice(aid: int, file: UploadFile = File(...), passage_words: int = Form(81)):
    return _run(aid, "voice", lambda data: voice.analyze_wav(data, passage_words), await file.read())


@app.post("/api/assessments/{aid}/labs/{lab}")
def submit_lab(aid: int, lab: str, raw: dict = Body(...)):
    if lab not in JSON_LABS:
        raise HTTPException(404, f"Unknown lab {lab}")
    return _run(aid, lab, JSON_LABS[lab], raw)


@app.get("/api/assessments/{aid}")
def assessment_detail(aid: int):
    a = store.get_assessment(aid)
    if not a:
        raise HTTPException(404, "Assessment not found")
    scored, _ = baseline.score_timeline(store.profile_assessments(a["profile"]))
    match = next((s for s in scored if s["id"] == aid), None)
    return {**a, "score": match}


@app.delete("/api/assessments/{aid}")
def remove_assessment(aid: int):
    store.delete_assessment(aid)
    return {"ok": True}


@app.get("/api/profiles/{profile}/timeline")
def timeline(profile: str):
    scored, base = baseline.score_timeline(store.profile_assessments(profile))
    return {
        "profile": profile,
        "min_baseline": baseline.MIN_BASELINE,
        "baseline_window": baseline.BASELINE_WINDOW,
        "baseline": {k: {"median": m, "spread": s} for k, (m, s) in base.items()},
        "assessments": scored,
        "change_points": baseline.detect_change_points(scored),
    }


@app.post("/api/demo/seed")
def seed_demo():
    return {"profile": demo.seed()}


@app.get("/api/research/voice-model")
def voice_model_summary():
    try:
        return voice_model.summary()
    except (ImportError, FileNotFoundError) as e:
        raise HTTPException(503, f"Voice model unavailable: {e}")


@app.get("/api/research/voice-model/people/{n}")
def voice_model_person(n: int):
    try:
        return voice_model.person(n)
    except KeyError:
        raise HTTPException(404, "No such held-out person")


# ---------- serve built frontend if present ----------
DIST = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = os.path.join(DIST, path)
        return FileResponse(f if path and os.path.isfile(f) else os.path.join(DIST, "index.html"))
