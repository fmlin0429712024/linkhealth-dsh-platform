"""Thin read API over the vision-insights SQLite datastore.

GET /health
GET /v1/events?since=<ISO8601>&zone=<id>&limit=<n>&include_markers=<0|1>
GET /v1/checkout-events?since=<ISO8601>&action=<add|remove>&limit=<n>

Deterministic facts only — no inference, no judgment calls. DSH plugin tools
are the only intended callers; the LLM narrates whatever this returns, it
never talks to SQLite directly.

Two tables, two endpoints, because the two source kits' event shapes have no
fields in common (per-zone occupancy vs. item add/remove) — see
docs/PRD-vision-insights.md §9 Q1. A third kit gets a third table + a third
endpoint here, following the same pattern, rather than forcing everything
into one wide nullable-column table.
"""
import sqlite3
from typing import Optional

from fastapi import FastAPI, Query

DB_PATH = "/opt/vision-insights-store/events.db"

app = FastAPI(title="LinkHealth Vision Insights — events read API")


def get_conn():
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def table_count(conn, table: str) -> Optional[int]:
    try:
        return conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
    except sqlite3.OperationalError:
        return None  # table doesn't exist yet — no ingest has run for this kit


@app.get("/health")
def health():
    try:
        conn = get_conn()
        result = {"status": "ok", "events": table_count(conn, "events"), "checkout_events": table_count(conn, "checkout_events")}
        conn.close()
        return result
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@app.get("/v1/events")
def list_events(
    since: Optional[str] = Query(None, description="ISO-8601 timestamp; only events at or after this"),
    zone: Optional[str] = Query(None, description="filter to one zone id"),
    limit: int = Query(100, ge=1, le=1000),
    include_markers: bool = Query(False, description="include event=stream_end run-boundary rows"),
):
    clauses = []
    params = []
    if not include_markers:
        clauses.append("event IS NULL")
    if since:
        clauses.append("ts >= ?")
        params.append(since)
    if zone:
        clauses.append("zone = ?")
        params.append(zone)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"SELECT ts, zone, count, avg_count, capacity, over_capacity, source, event FROM events {where} ORDER BY ts DESC LIMIT ?"
    params.append(limit)

    conn = get_conn()
    rows = conn.execute(sql, params).fetchall()
    conn.close()

    return {
        "events": [
            {
                "ts": r["ts"],
                "zone": r["zone"],
                "count": r["count"],
                "avg_count": r["avg_count"],
                "capacity": r["capacity"],
                "over_capacity": bool(r["over_capacity"]),
                "source": r["source"],
                "event": r["event"],
            }
            for r in rows
        ],
        "count": len(rows),
    }


@app.get("/v1/checkout-events")
def list_checkout_events(
    since: Optional[str] = Query(None, description="timestamp; only events at or after this"),
    action: Optional[str] = Query(None, description="filter to 'add' or 'remove'"),
    limit: int = Query(100, ge=1, le=1000),
):
    clauses = []
    params = []
    if since:
        clauses.append("ts >= ?")
        params.append(since)
    if action:
        clauses.append("action = ?")
        params.append(action)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"SELECT ts, class, action, message, source FROM checkout_events {where} ORDER BY ts DESC LIMIT ?"
    params.append(limit)

    conn = get_conn()
    try:
        rows = conn.execute(sql, params).fetchall()
    except sqlite3.OperationalError:
        rows = []  # no checkout ingest has run yet
    conn.close()

    return {
        "events": [
            {
                "ts": r["ts"],
                "class": r["class"],
                "action": r["action"],
                "message": r["message"],
                "source": r["source"],
            }
            for r in rows
        ],
        "count": len(rows),
    }
