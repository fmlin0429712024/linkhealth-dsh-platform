"""Ingest insights.jsonl (Intelligent Queue Management kit output) into a
SQLite WAL-mode datastore. Rebuilds the events table from scratch each run —
the source JSONL is a per-demo-run snapshot, not an append-only stream, so
idempotent rebuild is simpler and correct than incremental upsert here.

Schema note (see docs/PRD-vision-insights.md §4): a row with
event="stream_end" is a run-boundary marker, not a real zone sample — it's
stored (for completeness/debugging) but callers filtering for real occupancy
data should exclude it (the read API does this by default).
"""
import json
import sqlite3
import sys

LOG_PATH = sys.argv[1] if len(sys.argv) > 1 else "/opt/openvino-queue-kit/repo/ai_ref_kits/intelligent_queue_management/data/insights/insights.jsonl"
DB_PATH = sys.argv[2] if len(sys.argv) > 2 else "/opt/vision-insights-store/events.db"

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("DROP TABLE IF EXISTS events")
conn.execute(
    """
    CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        zone TEXT NOT NULL,
        count INTEGER NOT NULL,
        avg_count REAL NOT NULL,
        capacity INTEGER NOT NULL,
        over_capacity INTEGER NOT NULL,
        source TEXT NOT NULL,
        event TEXT
    )
    """
)
conn.execute("CREATE INDEX idx_events_ts ON events(ts)")
conn.execute("CREATE INDEX idx_events_zone ON events(zone)")

count = 0
with open(LOG_PATH) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        e = json.loads(line)
        conn.execute(
            "INSERT INTO events (ts, zone, count, avg_count, capacity, over_capacity, source, event) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                e["ts"],
                e["zone"],
                e["count"],
                e["avg_count"],
                e["capacity"],
                1 if e["over_capacity"] else 0,
                e["source"],
                e.get("event"),
            ),
        )
        count += 1

conn.commit()
conn.close()
print(f"ingested {count} events from {LOG_PATH} into {DB_PATH}")
