"""SQLite storage. One file, no server. Raw inputs are not stored, only features and plot traces."""

import json
import math
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

DB_PATH = os.environ.get("NEUROMAP_DB", os.path.join(os.path.dirname(__file__), "..", "data", "neuromap.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile TEXT NOT NULL,
    created_at TEXT NOT NULL,
    synthetic INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS results (
    assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    lab TEXT NOT NULL,
    features TEXT NOT NULL,
    trace TEXT NOT NULL,
    PRIMARY KEY (assessment_id, lab)
);
"""


@contextmanager
def db():
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript(SCHEMA)
    try:
        yield con
        con.commit()
    finally:
        con.close()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def create_assessment(profile: str, created_at: str | None = None, synthetic: bool = False) -> int:
    with db() as con:
        cur = con.execute("INSERT INTO assessments (profile, created_at, synthetic) VALUES (?, ?, ?)",
                          (profile, created_at or now_iso(), int(synthetic)))
        return cur.lastrowid


def get_assessment(aid: int) -> dict | None:
    with db() as con:
        row = con.execute("SELECT * FROM assessments WHERE id = ?", (aid,)).fetchone()
        if not row:
            return None
        results = con.execute("SELECT * FROM results WHERE assessment_id = ?", (aid,)).fetchall()
    return {
        **dict(row),
        "labs": {r["lab"]: {"features": json.loads(r["features"]), "trace": json.loads(r["trace"])}
                 for r in results},
    }


def clean(o):
    """Make results JSON-safe: NaN/inf -> None, numpy scalars -> Python floats."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if hasattr(o, "item") and not isinstance(o, (str, bytes)):
        o = o.item()
    if isinstance(o, (float, int)) and not isinstance(o, bool):
        f = float(o)
        return f if math.isfinite(f) else None
    return o


def save_result(aid: int, lab: str, features: dict, trace: dict):
    features = {k: v for k, v in clean(features).items() if v is not None}
    trace = clean(trace)
    with db() as con:
        con.execute("INSERT OR REPLACE INTO results (assessment_id, lab, features, trace) VALUES (?, ?, ?, ?)",
                    (aid, lab, json.dumps(features), json.dumps(trace)))


def delete_assessment(aid: int):
    with db() as con:
        con.execute("DELETE FROM assessments WHERE id = ?", (aid,))


def delete_profile(profile: str):
    with db() as con:
        con.execute("DELETE FROM assessments WHERE profile = ?", (profile,))


def list_profiles() -> list[dict]:
    with db() as con:
        rows = con.execute("""
            SELECT a.profile, COUNT(DISTINCT a.id) AS n, MAX(a.synthetic) AS synthetic, MAX(a.created_at) AS last
            FROM assessments a JOIN results r ON r.assessment_id = a.id
            GROUP BY a.profile ORDER BY last DESC
        """).fetchall()
    return [dict(r) for r in rows]


def profile_assessments(profile: str) -> list[dict]:
    """Assessments with at least one lab result, oldest first, features merged across labs."""
    with db() as con:
        rows = con.execute("""
            SELECT a.id, a.created_at, a.synthetic, r.lab, r.features
            FROM assessments a JOIN results r ON r.assessment_id = a.id
            WHERE a.profile = ? ORDER BY a.created_at, a.id
        """, (profile,)).fetchall()
    out: dict[int, dict] = {}
    for r in rows:
        a = out.setdefault(r["id"], {"id": r["id"], "created_at": r["created_at"],
                                     "synthetic": bool(r["synthetic"]), "labs": [], "features": {}})
        a["labs"].append(r["lab"])
        a["features"].update(json.loads(r["features"]))
    return list(out.values())
