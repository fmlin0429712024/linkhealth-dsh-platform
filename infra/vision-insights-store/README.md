# infra/vision-insights-store

**Status: brought under version control and redeployed, 2026-08-19**
(previously existed only as hand-deployed files on
`linkhealth-openvino-vision`, per
[docs/PRD-vision-insights.md](../../docs/PRD-vision-insights.md) §8). Local
round-trip (ingest → read API → curl) verified the same day for both event
shapes — see "Testing locally" below — then the updated copy (with
`checkout_events` support) was pushed to the VM and the service restarted;
both `events` and `checkout_events` are live in production, each queried
through the deployed DSH agent's tools.

The **Insight Storage** layer: a small SQLite WAL datastore plus a thin
FastAPI read API, sitting between the OpenVINO edge apps
(`../openvino-queue-kit/`, `../openvino-self-checkout/`) and DSH. Ingest
scripts here turn each app's JSONL output into SQLite tables; the read API
serves them over HTTP. See [../README.md](../README.md) for how this fits
the overall architecture, and
[docs/PRD-vision-insights.md](../../docs/PRD-vision-insights.md) §3 for why
it's deliberately the *only* thing DSH plugins are allowed to talk to (never
the OpenVINO apps directly).

No CI/CD for this layer, matching the OpenVINO apps' status — see the PRD's
non-goals.

## Layout

- `events_api.py` — FastAPI app: `GET /health`, `GET /v1/events` (queue-kit
  shape), `GET /v1/checkout-events` (self-checkout shape). Read-only against
  SQLite (`mode=ro`).
- `ingest.py` — rebuilds the `events` table from a queue-kit
  `insights.jsonl`. Unmodified from the version that's been running in
  production since Phase 2.
- `ingest_checkout.py` — same idea, new: rebuilds `checkout_events` from a
  self-checkout `insights.jsonl`.
- `vision-insights-api.service` — the systemd unit as deployed on
  `linkhealth-openvino-vision`.
- `requirements.txt` — exact pins captured via `pip freeze` against the
  running production venv (this file didn't exist anywhere before today).
- `testdata/sample_queue_events.jsonl` — a handful of synthetic
  queue-kit-shaped events, for sanity-checking `ingest.py` without needing
  the full queue-kit venv (NNCF/COCO calibration data) set up locally.

## Why two tables instead of one

`events` (queue-kit: per-zone occupancy counts) and `checkout_events`
(self-checkout: item add/remove) share no fields — forcing them into one
table would mean a wide table of mostly-`NULL` columns that gets worse with
every new kit. Each kit gets its own table + its own ingest script + its own
read endpoint instead; a third kit follows the same pattern. This is the
answer to the schema question left open in
[docs/PRD-vision-insights.md](../../docs/PRD-vision-insights.md) §9 Q1.

(§9 Q2 — resolved as one DSH tool per table, `query_vision_events` /
`query_checkout_events`, not a `kind` filter — that's plugin-side design,
out of scope for this directory; see §10 for the reasoning.)

## Testing locally (no DSH needed)

The whole ingest → store → serve → query loop can be verified with nothing
but curl — this is exactly how it was verified on 2026-08-19:

```sh
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt

# ingest — either kit's insights.jsonl works, or the bundled fixture:
./venv/bin/python ingest.py testdata/sample_queue_events.jsonl /tmp/test_events.db
./venv/bin/python ingest_checkout.py \
  ../openvino-self-checkout/repo/ai_ref_kits/automated_self_checkout/data/insights/insights.jsonl \
  /tmp/test_events.db

# serve (DB_PATH is a module-level constant in events_api.py, not an env
# var — override it directly if not using the default /opt path):
./venv/bin/python -c "
import events_api
events_api.DB_PATH = '/tmp/test_events.db'
import uvicorn
uvicorn.run(events_api.app, host='127.0.0.1', port=8099)
"

# in another shell:
curl http://127.0.0.1:8099/health
curl "http://127.0.0.1:8099/v1/events?zone=zone0&limit=5"
curl "http://127.0.0.1:8099/v1/checkout-events?action=add&limit=5"
```

## Deploying (VM)

Done, 2026-08-19: the four Python/service files here were copied to
`/opt/vision-insights-store/` on `linkhealth-openvino-vision`, dependencies
installed into its venv, and `vision-insights-api` restarted — the existing
`events` data (queue-kit) was untouched by the upgrade. `ingest_checkout.py`
was then run there against `openvino-self-checkout`'s VM-side output,
populating `checkout_events` with real production data (335 events). To
redeploy after further local changes: repeat that copy → `pip install -r
requirements.txt` → `sudo systemctl daemon-reload && sudo systemctl restart
vision-insights-api` sequence.
