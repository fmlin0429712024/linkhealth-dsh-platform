"""Ingest insights.jsonl (Automated Self-Checkout kit output, via
infra/openvino-self-checkout/headless_driver.py) into the same SQLite
WAL-mode datastore ingest.py uses — a separate table, `checkout_events`,
because the event shape (item add/remove) has no fields in common with the
queue kit's per-zone occupancy shape in `events` (see
docs/PRD-vision-insights.md §9 Q1). Same idempotent rebuild-from-scratch
approach as ingest.py, same reasoning: the source JSONL is a per-demo-run
snapshot, not an append-only stream.
"""
import json
import sqlite3
import sys

LOG_PATH = sys.argv[1] if len(sys.argv) > 1 else "/opt/openvino-self-checkout/repo/ai_ref_kits/automated_self_checkout/data/insights/insights.jsonl"
DB_PATH = sys.argv[2] if len(sys.argv) > 2 else "/opt/vision-insights-store/events.db"

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("DROP TABLE IF EXISTS checkout_events")
conn.execute(
    """
    CREATE TABLE checkout_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        class TEXT NOT NULL,
        action TEXT NOT NULL,
        message TEXT NOT NULL,
        source TEXT NOT NULL
    )
    """
)
conn.execute("CREATE INDEX idx_checkout_events_ts ON checkout_events(ts)")
conn.execute("CREATE INDEX idx_checkout_events_action ON checkout_events(action)")

count = 0
with open(LOG_PATH) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        e = json.loads(line)
        conn.execute(
            "INSERT INTO checkout_events (ts, class, action, message, source) VALUES (?, ?, ?, ?, ?)",
            (e["ts"], e["class"], e["action"], e["message"], e["source"]),
        )
        count += 1

conn.commit()
conn.close()
print(f"ingested {count} checkout events from {LOG_PATH} into {DB_PATH}")
