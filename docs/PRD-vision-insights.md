# PRD: Vision Insights — OpenVINO Edge Monitoring → Data Source → DSH Query

**Status: agreed direction (2026-08-19).** Supersedes the previous framing where
the DSH plugin talked directly to an OpenVINO pose service (`assess_exercise_form`).

## 1. Background & decision history

Why this design, in one sentence: **OpenVINO 视觉应用与 DSH 是完全独立的两个
App，唯一连接点是数据源（Insight Storage）；DSH 侧在集成完成前不感知 OpenVINO。**

| Date | Decision | Verdict |
| --- | --- | --- |
| 2026-08-18 | Fall detection / lying-pose classification (pose model) | ❌ rejected — model OOD on lying subjects |
| 2026-08-18 | PT/rehab form check (`assess_exercise_form`, bicep-curl elbow angle) | ⚠️ verified working, then **retired** — wrong primary use case; direct image coupling to OpenVINO contradicts the decoupled architecture |
| 2026-08-18 | Interactive analysis of DSH-attached images | ❌ rejected — harness text-route gate blocks attachments; `dsh-vision-router`'s free vision chain owns that UX |
| 2026-08-19 | **Intelligent Queue Management kit (YOLOv8m)** as the OpenVINO visual app | ✅ **current direction** — people counting in zones + capacity flagging, sample video included, pure simulation |
| 2026-08-19 | **Complete decoupling**: OpenVINO app (own storage) ‖ DSH (own app); integration only via data-source access, future | ✅ **current architecture** |

## 2. Goals & non-goals

### Goals
- **G1 (Phase 1)**: Get the OpenVINO visual app (queue kit) running end-to-end on
  `linkhealth-openvino-vision` with the included sample video — **pure simulation,
  no camera/hardware dependence**.
- **G2 (Phase 1)**: The app writes structured insight events (JSONL) — timestamp +
  zone + count (+ capacity flag) — at a regular interval.
- **G3 (Phase 2)**: Insight events land in a queryable data source (SQLite WAL)
  with a thin read API (`GET /v1/events`).
- **G4 (Phase 2)**: DSH accesses the data source through a plugin
  (`dsh-vision-insights-plugin`) — a `query_vision_events`-style tool for
  **certain questions** ("what happened in the last hour", "did any zone exceed
  capacity"). LLM narrates; the tool's facts are final.

### Non-goals (explicit)
- No local-model swap, no other AI kits (voice, etc.) — later phases.
- No hardware/camera integration — sample video only.
- **No CI/CD for the OpenVINO app** — it is a separate edge application, deployed
  manually (same status as the old `infra/openvino-vision` service). GitHub /
  DSH CI/CD stays parked for now.
- No patient-care relabeling yet — queue/customer framing for Phase 1.
- The DSH plugin does **not** contain or reach the OpenVINO app directly; it does
  **not** own the insight storage.

## 3. Architecture — decoupled through the data source

```
┌───────────────────────────────┐      write       ┌──────────────────────────┐
│ OpenVINO Visual App (edge)    │ ───────────────► │  Insight Storage          │
│  queue kit: YOLOv8m IR+INT8,  │  insight events  │  Phase 1: JSONL file      │
│  zones, capacity, sample video│  (JSONL → SQLite)│  Phase 2: SQLite WAL +    │
│  OWN app, OWN storage, manual │                  │  GET /v1/events (thin)    │
│  deploy — NOT part of DSH     │                  │  OWN storage — NOT part   │
└───────────────────────────────┘                  │  of the DSH plugin        │
                                                   └────────────▲─────────────┘
                                                        read    │
                                                   ┌────────────┴─────────────┐
                                                   │ DSH (separate app)        │
                                                   │  dsh-vision-insights-     │
                                                   │  plugin: query tool for   │
                                                   │  certain questions        │
                                                   │  (Phase 2, integration    │
                                                   │  effort)                  │
                                                   └──────────────────────────┘
```

- **Boundary rule**: the only contract between the two apps is the **event
  schema**. OpenVINO app doesn't know DSH exists; DSH doesn't know how inference
  happens.
- **Status today**: integration effort **not started**. The DSH plugin is a
  scaffold; the OpenVINO app is the current focus.

## 4. Event contract (draft — to be calibrated by Phase 1 real output)

```jsonl
{"ts":"2026-08-19T10:15:00Z","zone":"entrance","count":3,"capacity":5,"over_capacity":false,"source":"queue-kit-sim"}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `ts` | string ISO-8601 UTC | event time |
| `zone` | string | configured zone id |
| `count` | integer | people detected in the zone |
| `capacity` | integer | zone threshold |
| `over_capacity` | boolean | `count > capacity` (deterministic flag) |
| `source` | string | sampler/app id (future: camera id) |

Phase 1's JSONL log must match this shape so Phase 2 (SQLite/`/v1/events`/DSH
query) needs no transformation.

## 5. Phase 1 tasks (current focus — run on `linkhealth-openvino-vision`)

1. **VM cleanup**: remove yesterday's pose service (old `openvino-vision.service`
   + `/opt/openvino-vision` venv/app). New VM is clean.
2. **Clone kit**: `openvino_build_deploy/ai_ref_kits/intelligent_queue_management`
   (archived repo, code intact); pull sample video via git-lfs (auto).
3. **New venv** + `pip install -r requirements.txt` (torch 2.8 CPU, ultralytics,
   nncf, supervision — ~3-4 GB, fits the VM disk).
4. **Convert model**: `convert_and_optimize.py --model_name yolov8m --quantize True`
   → OpenVINO IR + INT8.
5. **Run**: `app.py` + sample video → verify zone counting / capacity flag /
   overlay rendering.
6. **Add JSONL log** (if the kit has none): ts/zone/count/capacity/over_capacity,
   regular interval — matches §4.
7. *(Gated, after confirm)* minimal LLM read of the log: "what happened in the
   last hour".

## 6. Phase 2 (reserved — NOT started)

- Insight Storage: SQLite WAL (stdlib `sqlite3`, precedent: `dsh-cdi-plugin`
  `audit_rules.db`) + thin FastAPI `GET /v1/events?since=&zone=&limit=`.
- DSH plugin `dsh-vision-insights-plugin`: `query_vision_events` tool over
  `/v1/events` (baseUrl config; HTTP-mocked tests; deterministic tool decides,
  LLM narrates).
- Optional: scheduled analysis via harness `dsh-schedule`.

## 7. Open questions

- Phase 1 sample video: does the kit's demo clip contain a dramatic moment
  (queue build-up / capacity exceeded) worth a demo narrative? — verify in Phase 1.
- LLM read-of-log in Phase 1 (task 7): cloud API call — confirm before doing.
- Phase 2 data source: SQLite confirmed; revisit if real-time/streaming needs grow.
- Whether `dsh-vision-insights-plugin` stays in the deployed profile (vm2) during
  Phase 1 — leave as-is (inert scaffold), no deploy changes.
