# PRD: Vision Insights — OpenVINO Edge Monitoring → Data Source → DSH Query

**Status: all four phases done and verified end-to-end in production
(2026-08-19).** Supersedes the previous framing where the DSH plugin talked
directly to an OpenVINO pose service (`assess_exercise_form`). Phase 3
(version-control the Insight Storage layer) is deployed — both `events` and
`checkout_events` live on the VM. Phase 4 (second data source,
`automated_self_checkout`) is fully done: headless pipeline, Insight Storage
ingest path (§9 Q1), and the `query_checkout_events` DSH tool (§9 Q2, §10)
are all built, deployed, and verified through the live agent. See §8-10 for
detail. This spec was written before any Phase 3/4 code landed, per this
repo's SDD convention — specifically because Phase 3's discovery surfaced a
real schema question (§8) that would have been easy to miss by jumping
straight to "copy the VM's files into the repo."

**Production verification (2026-08-19, `linkhealth-vm2`, release
`linkhealth-c1823f7`)**: asked the deployed LinkHealth agent "Did any zone
exceed capacity in the vision insights data? Give me a per-zone summary." —
it correctly called `query_vision_events` (not a coding-tool workaround) and
reported `zone0: 14 events, 1 over-capacity, max 5` / `zone1: 14, 0, max 4` /
`zone2: 14, 0, max 5`, matching every independent `curl` check against the
read API throughout Phase 2 development exactly. Full pipeline confirmed:
OpenVINO app → JSONL → SQLite → read API → `query_vision_events` → LLM
narration → correct answer.

**Production verification, Phase 4 (2026-08-19, `linkhealth-vm2`)**: asked
the deployed agent "购物篮里现在还剩什么？" ("what's currently in the
basket?") — it called `query_checkout_events` and reported `apple: 8,
banana: 42, bottle: 15, carrot: 1, orange: 1` (67 total), matching an
independent recount of the read API's raw 335 `checkout_events` rows
exactly. Same full pipeline as above, second data source: OpenVINO
self-checkout app → JSONL → SQLite → read API → `query_checkout_events` →
LLM narration → correct answer.

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

### Evidence behind the two rejected/retired directions (2026-08-19)

The pose-estimation scaffolding this evidence came from
(`infra/openvino-vision/`: `serve.py`, `timeline_test.py`, `pt_test.py`, test
images) was **removed from the working tree on 2026-08-19** — it was
exploratory infrastructure from before the decoupled architecture above was
settled, not a maintained deliverable, and this repo already has the
precedent of not keeping retired code around (see
`dsh-vision-insights-plugin`'s README on why `assess_exercise_form` was
deleted rather than archived). The code is recoverable from git history if
ever needed; the numbers below are what actually justified the two verdicts
in the table, so they're captured here instead of only in a deleted file.

**Why fall/lying-pose detection was rejected**: `human-pose-estimation-0001`
was tested against a real fall clip
([computationalcore/fall-detection](https://github.com/computationalcore/fall-detection),
`example/demo.mp4`, 21.3s/532 frames), sampling every 8 frames from t=15.2s
onward:

```
t=15.2–15.5s  upright, Low
t=15.8s       insufficient_evidence
t=16.2s       possible_fall_or_lying, High, torso angle 71.5°   <- caught it, one frame
t=16.5–21.0s  insufficient_evidence, continuously, for the rest of the clip
```

It caught the fall transition confidently in exactly one frame, then lost
the signal entirely for the ~4.5s the subject lay still — the opposite of
what you'd expect if a settled pose were easier to read than a dynamic one.
Conclusion: the model is trained mostly on upright/pedestrian poses, so a
person lying flat is out-of-distribution for the model itself, not a
decoder bug or a threshold-tuning problem.

**Why PT/rehab form tracking (`assess_exercise_form`) was verified, then
separately retired for an architecture reason**: the same model, applied to
a bicep-curl clip
([stevenzchen/pose-trainer](https://github.com/stevenzchen/pose-trainer),
`sample_bicep_curl.mp4`), tracking elbow angle (shoulder–elbow–wrist) across
20 sampled frames of one rep:

```
t=0.0s  156.8°  (arm extended)            avg confidence 0.44
t=0.8s   35.7°  (fully curled)            avg confidence 0.29
t=0.9s  175.4°  <- outlier reading                          avg confidence 0.12 (lowest in the clip)
t=1.0s   35.6°  (back to curled, correct) avg confidence 0.31
t=2.2s  159.6°  (extended again)          avg confidence 0.44
```

This traced a clean rep (extended → curled → extended) as a smooth angle
curve; confidence stayed moderate (~0.4) and never collapsed the way it did
for the lying pose. The one clearly wrong reading (175.4°) coincided with
the single lowest confidence value in the whole clip (0.12) — the confidence
score itself would have caught it. This *use case* worked; it was retired
anyway (§ "Why the previous tool is gone" in
`dsh-vision-insights-plugin`'s README) because it called the OpenVINO
service directly from the DSH plugin, which is exactly the tight coupling
the decoupled architecture below was adopted to avoid — not because the
tracking itself was unreliable.

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

## 8. Phase 3 (done, 2026-08-19) — version-control the Insight Storage layer

**Problem**: Phase 2's SQLite ingest script and FastAPI read API were written
and deployed straight onto `linkhealth-openvino-vision`
(`/opt/vision-insights-store/`) and were never committed anywhere — there is
no source-of-truth copy in this repo, no tests, no review path, no diff
history. Every other piece of infra here (the OpenVINO kits, the DSH
plugins) is version-controlled even where it isn't CI/CD'd; this layer is the
one exception, and it's the piece both Phase 2 and any future data source
depend on.

**Current state** (confirmed via read-only `gcloud compute ssh
--tunnel-through-iap` into `linkhealth-openvino-vision`, 2026-08-19 — no
changes made to the VM):

- `/opt/vision-insights-store/events_api.py` — FastAPI app, single route
  `GET /v1/events?since=&zone=&limit=&include_markers=`, reads SQLite
  read-only (`mode=ro`), returns rows shaped
  `{ts, zone, count, avg_count, capacity, over_capacity, source, event}`.
  Also `GET /health` (row count).
- `/opt/vision-insights-store/ingest.py` — takes a JSONL path (default: the
  queue kit's `insights.jsonl`) and a DB path, **drops and rebuilds the
  `events` table from scratch every run** (the source JSONL is a per-demo-run
  snapshot, not an append-only stream — see original code comment). Table
  columns are exactly the queue-kit event shape from §4 and hard-coded to
  it — `zone`, `count`, `avg_count`, `capacity`, `over_capacity` are all
  `NOT NULL` columns.
- `vision-insights-api.service` (systemd): `uvicorn events_api:app --host
  0.0.0.0 --port 8090`, user `fmlin`, `Restart=on-failure`.
- venv `pip freeze`: `fastapi==0.141.1`, `uvicorn==0.52.3`,
  `pydantic==2.13.4`, plus transitive deps — no `requirements.txt` exists
  anywhere today; this freeze is the only record of the pinned versions
  actually running in production.

**Goals**:
- **G1**: Land `events_api.py`, `ingest.py`, the systemd unit, and a pinned
  `requirements.txt` in this repo (proposed: `infra/vision-insights-store/`,
  alongside `infra/openvino-vision/` and the kit dirs) as the source of
  truth.
- **G2**: A change to this layer becomes "edit in repo → manually redeploy to
  the VM," matching the OpenVINO kits' status (version-controlled, manually
  deployed, no CI/CD) instead of "SSH in and hand-edit the running file."

**Non-goals**:
- No CI/CD for this layer — same reasoning as the OpenVINO app side (§2
  non-goals): it's edge/support infra, not a DSH plugin.
- Not migrating off SQLite/FastAPI.

**Done (2026-08-19)**: landed at `infra/vision-insights-store/` —
`events_api.py`, `ingest.py` (byte-for-byte the version pulled from the VM),
`vision-insights-api.service`, and `requirements.txt` (exact pins from the
production venv's `pip freeze`, which existed nowhere as a file before
this). G1 and G2 both met. **Redeployed the same day**: this
version-controlled copy (now with `checkout_events` support added, see §9)
was pushed to `linkhealth-openvino-vision` and the service restarted —
existing `events` data untouched, `checkout_events` added alongside it.

Resolved the open question this section originally carried into Phase 4
(§9 Q1): rather than widening `events`' fixed columns or rebuilding
`ingest.py` to be schema-generic, self-checkout's events got their own
table (`checkout_events`) and their own ingest script
(`ingest_checkout.py`), added alongside the untouched original `ingest.py`
— see §9 for why and the verification.

## 9. Phase 4 (done — infra and DSH tool both deployed & verified in production, 2026-08-19) — second data source: `automated_self_checkout`

**Candidate kit**:
[`automated_self_checkout`](https://github.com/openvinotoolkit/openvino_build_deploy/tree/master/ai_ref_kits/automated_self_checkout)
— retail item add/remove detection and tracking from a video stream.
Research clone (read-only, sparse checkout + LFS sample video, gitignored)
sits at `infra/openvino-self-checkout/repo/`, mirroring how
`infra/openvino-queue-kit/repo/` was set up for Phase 1.

**Why this is a bigger lift than the queue kit was (Phase 1)**:

- **No headless entrypoint.** The queue kit's `app.py` already supported
  `--headless` and only needed a small patch to add `--insights_log`
  (§5 task 6). `automated_self_checkout`'s `directrun.py` has no CLI mode at
  all — its detection/tracking loop, `stream_object_detection()`, is a
  **Gradio generator callback** (`yield gr.skip()` / UI component updates),
  and `__main__` calls `demo.launch(inbrowser=True, ...)` to start a Gradio
  web server. Getting a "run once over the sample video, write structured
  events, exit" flow (the queue-kit pattern this PRD depends on) means
  extracting the core loop out of the Gradio callback — not a config flag.
- **Different event shape.** The kit already emits structured events
  internally — `plog(logtable, message, pclass, pop)` appends
  `{time, class, action(add/remove), message}` rows — but to a Gradio
  `DataFrame` for on-screen display, not to a file. This shape (item
  add/remove) doesn't fit the current `events` table (§8) at all, unlike a
  same-shape second queue-style deployment would.
- **Heavier dependencies**: `gradio==6.7.0` (web/socket stack), a PyTorch CPU
  wheel (`--extra-index-url https://download.pytorch.org/whl/cpu`),
  `ultralytics`, `onnx`, `supervision`, `nncf` — meaningfully more than the
  queue kit. Worth checking `linkhealth-openvino-vision`'s disk/RAM headroom
  before running both kits on the same VM.
- **Install script doesn't transfer.** Upstream's `setup/setup.sh` assumes
  Ubuntu 22.04+, a `~/oneclickai` home-directory install, and apt-installed
  system packages — it doesn't match this repo's `/opt/<kit>` deployment
  convention. Only the underlying steps (venv, `pip install -r
  requirements.txt`, model conversion) transfer; the one-click script itself
  doesn't.

**Goals** (mirrors §2's G1-G4 shape for the queue kit):
- **G1 — done**: a headless driver
  (`infra/openvino-self-checkout/headless_driver.py`) runs once over the
  bundled sample video and writes structured JSONL events, without editing
  the vendored `directrun.py`. Along the way it also worked around a real
  upstream bug — `ascd_init()`'s default IR export is static-batch
  (`dynamic=False`), but the detection loop always calls `model.track(...,
  batch=14, ...)`, which fails against a static-batch model; the driver
  pre-exports with `dynamic=True` instead. Verified 2026-08-19: 377 events
  (196 add / 181 remove) from the 21.3s/640-frame sample video, ~30-40s
  runtime. Caveat: verified against newer, mutually-compatible dependency
  versions, not the exact pins in `requirements.txt` — see that kit's
  README "Dependency note."
- **G2 — done**: those events land in Insight Storage via a new table +
  ingest script + read endpoint, kept separate from the queue kit's (§8's
  resolution to Q1 below) — `checkout_events` /
  `infra/vision-insights-store/ingest_checkout.py` /
  `GET /v1/checkout-events`. Verified 2026-08-19 with a full local
  round-trip: ran the headless driver → `ingest_checkout.py` → local
  `uvicorn` → curl `/v1/checkout-events?action=add` and
  `/v1/checkout-events?limit=1000`, confirmed the 196/181 add/remove split
  matches the driver's own summary exactly. No DSH involved in this
  verification — see `infra/vision-insights-store/README.md` "Testing
  locally."
- **G3 — done, deployed, and verified in production.** `query_checkout_events`
  implemented in `plugins/dsh-vision-insights-plugin/lib/query-checkout-events.js`
  + registered in `lib/index.js` per Q2's resolution (§10). Unit-tested
  (`test/query-checkout-events.test.mjs`, HTTP-mocked) and verified against a
  live read API: ingested the real 377-event self-checkout sample into a
  throwaway SQLite DB, served it with the actual `events_api.py`, called the
  tool's real function (no mocking) over HTTP — net-basket summary
  (`banana: +23`, `apple: -8`, `bottle` netted to 0 and correctly omitted)
  matched an independent Python recount exactly. The same pass re-ran
  `query_vision_events` against its fixture as a regression check — still
  correct after adding the second tool (`zone0: 2 events, 1 over-capacity,
  max 4`, matching pre-change behavior). One real bug surfaced by testing
  against real data instead of only synthetic fixtures: the kit sometimes
  emits tracker id `"None"` (e.g. `"#None apple"`), which an initial
  digits-only strip regex missed, splitting that item's count in two — fixed
  and pinned with a regression test. Full detail in this package's README
  "The tools" section. **Deployed and verified in production, 2026-08-19**:
  pushed to `main`, `deploy.yml`'s e2e gate + deploy job both passed, then
  asked the live deployed agent "购物篮里现在还剩什么？" — it called
  `query_checkout_events` (confirmed via the tool-call trace) and reported
  `apple: 8, banana: 42, bottle: 15, carrot: 1, orange: 1` (67 total),
  matching an independent recount of the production read API's raw 335
  `checkout_events` rows exactly. (`query_vision_events` was regression-
  checked pre-deploy, not re-asked through the live agent this pass — see
  §10's local-verification note and this package's README.)

**Non-goals**: same as §2 — no camera/hardware integration, no CI/CD for the
edge app, sample-video/synthetic data only.

**Q1 (schema) — resolved, 2026-08-19**: separate table + ingest script +
read endpoint per kit (`checkout_events` / `ingest_checkout.py` /
`GET /v1/checkout-events`), not a widened `events` table or parallel DBs —
see `infra/vision-insights-store/README.md` "Why two tables instead of
one." Establishes the pattern a third kit would follow.

**Q2 (DSH tool surface) — resolved, 2026-08-19**: self-checkout gets its own
tool, `query_checkout_events`, in the existing `dsh-vision-insights-plugin`
package (not a `source`/`kind` filter grafted onto `query_vision_events`,
and not a new plugin). See §10 for the full reasoning, including why this
does **not** need a triage-style dispatch layer in front of it. G3 (tool
design itself — parameters, summary shape) is next, unblocked.
- **Q3 (capacity)**: benchmark `linkhealth-openvino-vision`'s disk/RAM before
  installing this kit's heavier deps alongside the queue kit's.

## 10. Design decision — tool routing inside `dsh-vision-insights-plugin` (2026-08-19)

**Question**: now that the plugin is about to hold two tools —
`query_vision_events` (zone occupancy) and the planned
`query_checkout_events` (self-checkout basket events) — does it need an
explicit *dispatch* layer, modeled on `dsh-triage-plugin`'s `intake-triage`
skill, to decide which tool answers a given user question? Or is relying on
the DSH/Cordis tool-calling mechanism — the LLM matching a question against
each `tools.register(...)` call's `name`/`description`/`parameters`, the
same mechanism that already selects `query_vision_events` among every other
tool in the profile today — sufficient on its own?

**Decision**: no dispatcher. `query_checkout_events` is added as a second,
independently-described tool in the same package; routing between the two
is left entirely to normal function-calling tool selection.

**Why `intake-triage`'s pattern doesn't transfer**, comparing what each
mechanism actually does (`plugins/dsh-triage-plugin/skills/intake-triage/SKILL.md`
vs. plain tool selection):

| | Function-calling tool selection (routes `query_vision_events` / `query_checkout_events`) | `intake-triage` (dsh-triage-plugin's hub skill) |
|---|---|---|
| What triggers it | The LLM reading tool descriptions while deciding what to call | A fixed multi-step workflow that runs on every inbound enquiry |
| What it decides | Which one existing tool answers this turn's question | Service-line classification **+** a scored complexity rubric (4 dimensions, 0–8) **+** a mandatory PHI/compliance guardrail |
| Is the mechanism itself business logic? | No — pure dispatch; each tool stays simple and independent | Yes — the classification and guardrail *are* the business logic; routing is a side effect of running it |
| Cost of it picking wrong | Wrong/no tool called this turn — low stakes, correctable next turn | Missed PHI guardrail → real compliance exposure — this risk is *why* the skill is hand-written prose instead of tool descriptions |

`intake-triage` isn't "a router that happens to also score things" — the
scoring and the hard guardrail (`phi_involved` → `requires_human_review`,
no auto-routing) are the entire reason it exists as a prose-driven skill
rather than plain tool descriptions. `query_vision_events` and
`query_checkout_events` answer disjoint questions from disjoint data (zone
occupancy vs. shopping-basket contents) with no scoring, no guardrail, and
no shared decision that a name+description match could get wrong in a way
that matters. Nothing in this pair has intake-triage's shape.

**When to revisit** (so this isn't a silent permanent assumption):
- A third vision-insight source arrives whose tool description overlaps an
  existing one enough that the LLM could plausibly pick the wrong tool.
- A cross-cutting guardrail requirement appears that must run *before*
  either tool executes (e.g. a future PHI-adjacent vision data source).
- A user question needs data combined from both tools in one answer
  (routing to "both" or synthesizing across them), not a single pick.

None of these hold today, so no dispatcher is being built now.

**Consequence for §9 G3**: proceed straight to designing
`query_checkout_events` itself (parameters, summary shape) as a second
`tools.register(...)` entry in `plugins/dsh-vision-insights-plugin/lib/index.js`
— that design work is no longer blocked on a routing-architecture decision.
