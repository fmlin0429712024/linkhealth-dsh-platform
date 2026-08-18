# dsh-vision-insights-plugin

**Status: reframed for the vision-insights architecture (2026-08-18).** This
package was renamed from `dsh-vision-plugin` to mark the pivot: OpenVINO's
right home is **IoT/edge streaming monitoring → structured insight events → LLM
analysis**, NOT interactive analysis of user-attached images inside the DSH
GUI. This plugin is the **DSH consumer side** of that architecture.

## Architecture: the insight store is the decoupling point

```
┌──────────────────────────┐   write    ┌──────────────────────┐   read    ┌──────────────────────────┐
│ OpenVINO edge pipeline   │ ─────────► │  Insight store        │ ◄──────── │ dsh-vision-insights-     │
│ (camera → frames → pose  │  events    │  (SQLite WAL + thin   │  query    │ plugin (DSH, consumer)   │
│  → deterministic rules)  │            │   HTTP /v1/events)    │           │ query_vision_events      │
└──────────────────────────┘            └──────────────────────┘           └──────────────────────────┘
      producer (DSH-external,                contract = event schema            consumer (DSH-internal)
      infra/openvino-vision)                                                        + LLM narration
```

- **Producer — DSH-external.** The edge sampler runs 24×7 (camera → frame
  sampling → `/v1/pose` inference → deterministic rules → **write events**). It
  lives in `infra/openvino-vision/` with its own lifecycle; it never knows DSH
  exists. Same split as today's `serve.py` vs this plugin — the decoupling
  point just moves from a bare HTTP endpoint to a store.
- **Store — the contract.** Both sides agree only on the event schema. SQLite
  (Python stdlib `sqlite3`, WAL mode, same precedent as `dsh-cdi-plugin`'s
  `audit_rules.db`) + a thin FastAPI `GET /v1/events?since=&risk_level=&limit=`
  query surface, so the consumer never needs a DB driver.
- **Consumer — this plugin.** Tools read **structured JSON events, never
  images** — which removes the image-modality problem entirely: the DeepSeek
  text route, the harness attachment gate, and the VLM chain are all
  irrelevant here. The pattern matches `dsh-cdi-plugin`'s `cdi_query_rule`:
  deterministic tool returns authoritative facts, the LLM only narrates.

### Why the split (learned the hard way today)

1. **Lifecycle**: the camera pipeline must run when no DSH session exists;
   a DSH plugin lives and dies with the agent process.
2. **Process coupling**: frame capture/inference inside the agent process makes
   a bad frame or an OOM take the session down with it.
3. **Modality-free**: today's interactive "analyze the attached image" path is
   blocked by the harness (text-only routes refuse image attachments) and is
   better served by `dsh-vision-router`'s free vision chain anyway. Insights
   bypass all of that — the LLM reads JSON.

### Event schema (draft)

```sql
CREATE TABLE events (
  ts         TEXT NOT NULL,        -- ISO-8601 UTC
  type       TEXT NOT NULL,        -- 'pose_abnormal' | 'upright' | 'signal_lost' | ...
  risk_level TEXT NOT NULL,        -- High | Medium | Low | Unknown
  angle_deg  REAL,                 -- the deterministic rule's key angle
  confidence REAL,                 -- mean keypoint confidence
  frame_ref  TEXT,                 -- source frame identifier (traceable)
  source     TEXT                  -- camera / sampler id
);
PRAGMA journal_mode = WAL;
```

Streaming changes the problem shape in the producer's favor: single-frame
"is this person lying down?" is unreliable (the model's known OOD limitation),
but **"upright → abnormal transition" is detectable** — the timeline test
caught the fall transition at 71.5° torso angle with High confidence, and the
subsequent confidence collapse is itself a signal. Monitoring looks for
*changes*, which is exactly what the deterministic rule can do.

## Current capability: `assess_exercise_form`

Deterministic single-frame PT/rehab form check (bicep-curl elbow angle) against
the OpenVINO `/v1/pose` service — the verified use case from
`infra/openvino-vision/README.md`. Geometry decides (extended ≥ 150°, curled
≤ 60°); the LLM only narrates. Real values reproduced on the VM: **156.8°**
(extended, conf 0.73) and **35.7°** (curled, conf 0.437), matching the
`pt_test.py` baseline.

Two image sources:
- `image_path` — a file on disk (relative to the session workspace or
  absolute). Always works.
- no `image_path` — the most recent session attachment. **Dormant** on
  text-only model routes (the harness refuses image attachments before the
  tool runs; `dsh-vision-router` owns that UX). Kept for future vision-capable
  routes.

## Roadmap (next)

1. `query_vision_events` tool — read insight events from the store's `/v1/events`
   (`since`, `risk_level`, `limit`); structured, authoritative; LLM narrates.
2. Edge sampler in `infra/openvino-vision/` — frame loop → `/v1/pose` →
   rule → SQLite WAL → `/v1/events` query endpoint.
3. Optional scheduled analysis via harness `dsh-schedule` (e.g. "nightly room
   event summary").

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | `''` | Base URL of the vision service(s). `assess_exercise_form` uses `/v1/pose`; `query_vision_events` will use `/v1/events`. Required for the tools to work. |
| `confidenceThreshold` | `0.1` | Per-keypoint confidence floor for the deterministic rule. |

Deployed via CI/CD (`deploy/profile-linkhealth/cordis.patch.yml`, instance id
`linkhealth-vision`) with `baseUrl: http://10.128.0.11:8080` (the OpenVINO
showcase VM, same VPC). The OpenVINO service itself is **not** part of this
repo's CI/CD — it is deployed manually (see `infra/openvino-vision/README.md`).

## Development & test

```sh
node --test                                   # 28 cases: geometry/rule, HTTP-mocked tool, entry contract
node scripts/check-plugin-contract.mjs        # repo contract check (from repo root)
node scripts/smoke-vision-tool.mjs http://127.0.0.1:8080   # via IAP tunnel to the showcase VM
```

Tests never touch the VM (fetch stubbed); the smoke script drives the real
tool against the live backend through an IAP/SSH tunnel. Everything here is
synthetic/test data only — never real patient data, never a clinical decision.
