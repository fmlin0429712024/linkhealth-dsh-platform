# PRD: Vision Insights — OpenVINO Edge Monitoring → Data Source → DSH Query

**Status: Phase 1 and Phase 2 both done and verified end-to-end in production
(2026-08-19).** Supersedes the previous framing where the DSH plugin talked
directly to an OpenVINO pose service (`assess_exercise_form`).

**Production verification (2026-08-19, `linkhealth-vm2`, release
`linkhealth-c1823f7`)**: asked the deployed LinkHealth agent "Did any zone
exceed capacity in the vision insights data? Give me a per-zone summary." —
it correctly called `query_vision_events` (not a coding-tool workaround) and
reported `zone0: 14 events, 1 over-capacity, max 5` / `zone1: 14, 0, max 4` /
`zone2: 14, 0, max 5`, matching every independent `curl` check against the
read API throughout Phase 2 development exactly. Full pipeline confirmed:
OpenVINO app → JSONL → SQLite → read API → `query_vision_events` → LLM
narration → correct answer.

Note: a local-only dev-profile harness (`linkhealth2`, port 3083) failed to
register this plugin's tool during development, for reasons not fully
diagnosed (suspected: that harness's sessions default to a "coding agent"
persona with filesystem tools instead of business tools, unlike the real
deployed profile). Doesn't block anything today; worth a proper look if it
slows down future local iteration on this plugin.

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
| 2026-08-19 | **Phase 1 done-when redefined**: done once the OpenVINO app produces a real, structured data source (verified — `insights.jsonl`, 43 lines, real run). The standalone "task 7" throwaway LLM-read script is dropped — that verification now happens directly inside Phase 2's `query_vision_events` tool/tests instead of a one-off script that would've been rebuilt anyway. | ✅ **Phase 1 complete**; Phase 2 starts next |

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

## 4. Event contract (calibrated 2026-08-19 against real Phase 1 output —
`/opt/openvino-queue-kit/repo/.../data/insights/insights.jsonl`, 43 lines)

```jsonl
{"ts": "2026-08-18T23:37:47.350357Z", "zone": "zone0", "count": 4, "avg_count": 4.0, "capacity": 3, "over_capacity": true, "source": "iqm-kit-sim"}
{"ts": "2026-08-18T23:38:37.328009Z", "zone": "zone-1", "count": 0, "avg_count": 0.0, "capacity": 3, "over_capacity": false, "source": "iqm-kit-sim", "event": "stream_end"}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `ts` | string ISO-8601 UTC | event time |
| `zone` | string | configured zone id (`zone0`/`zone1`/`zone2`; `zone-1` is a sentinel, see below) |
| `count` | integer | people detected in the zone at sample time |
| `avg_count` | number | **not in the original draft** — rolling average count, same sample |
| `capacity` | integer | zone threshold |
| `over_capacity` | boolean | `count > capacity` (deterministic flag) |
| `source` | string | sampler/app id — actual value `"iqm-kit-sim"`, not the draft's `"queue-kit-sim"` |
| `event` | string, optional | **not in the original draft** — only present on the final row, value `"stream_end"`, `zone` forced to `"zone-1"`, marks end-of-run rather than a real sample |

Phase 2 (SQLite/`/v1/events`) must store all of these columns and should skip
or separately flag `event: "stream_end"` rows — they're a run-boundary
marker, not a zone-occupancy sample, and would skew any aggregate over
`count`/`over_capacity` if treated as a normal event.

## 5. Phase 1 tasks — ✅ DONE (2026-08-19), verified independently against the VM

1. **VM cleanup**: remove yesterday's pose service (old `openvino-vision.service`
   + `/opt/openvino-vision` venv/app). ✅ confirmed gone.
2. **Clone kit**: `openvino_build_deploy/ai_ref_kits/intelligent_queue_management`
   (archived repo, code intact); pull sample video via git-lfs. ✅ present at
   `/opt/openvino-queue-kit/repo/...` on the VM; also cloned locally into
   `infra/openvino-queue-kit/repo/` (gitignored — see that directory).
3. **New venv** + `pip install -r requirements.txt`. ✅ present.
4. **Convert model** → OpenVINO IR + INT8. ✅ `model/yolov8m_openvino_int8_model/` present.
5. **Run**: `app.py` + sample video. ✅ `run_demo.sh` runs end-to-end (~51s).
6. **Add JSONL log**: `app.py.orig` vs `app.py` confirms the kit was patched
   (it ships with none); output verified — see §4 for the calibrated real shape.
7. ~~Gated LLM read-of-log~~ — **dropped as a separate task** (see decision
   history above); folded into Phase 2's `query_vision_events` tool/tests.

## 6. Phase 2 — current focus (starting 2026-08-19)

- Insight Storage: SQLite WAL (stdlib `sqlite3`, precedent: `dsh-cdi-plugin`
  `audit_rules.db`) + thin FastAPI `GET /v1/events?since=&zone=&limit=`, both
  running on `linkhealth-openvino-vision` (same VM as the OpenVINO app; still
  a separate process/service from it — the app writes JSONL, a separate
  ingestion step loads it into SQLite).
- DSH plugin `dsh-vision-insights-plugin`: `query_vision_events` tool over
  `/v1/events` (`baseUrl` config; HTTP-mocked tests; deterministic tool
  decides, LLM narrates — same pattern as `dsh-cdi-plugin`'s `cdi_query_rule`).
- Deployed to `linkhealth-vm2` under the `linkhealth` profile (the real
  deploy profile, not a dev one) — `DEEPSEEK_API_KEY` is already provisioned
  there per the CI/CD setup in `docs/ci-cd.md`.
- Optional: scheduled analysis via harness `dsh-schedule`.

## 7. Open questions

- Phase 1 sample video: does the kit's demo clip contain a dramatic moment
  (queue build-up / capacity exceeded)? — the real log shows `zone0` hit
  `over_capacity` at least once (`count=4 > capacity=3`); good enough for a
  demo narrative, not deeply investigated further.
- Phase 2 data source: SQLite confirmed; revisit if real-time/streaming needs grow.
- Whether `dsh-vision-insights-plugin` (with the new `query_vision_events`
  tool) gets wired into `deploy/profile-linkhealth/cordis.patch.yml` and
  actually pushed/deployed to vm2, vs. built and tested but held back from a
  real push — **confirm with the user before pushing to GitHub** (unrelated
  standing instruction, see `DSH-HANDOFF-PROMPT.md`).
