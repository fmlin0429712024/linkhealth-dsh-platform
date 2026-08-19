# infra/openvino-self-checkout

**Status: deployed and verified end-to-end in production (2026-08-19,
`linkhealth-openvino-vision`).** Ran with the kit's exact pinned
dependencies, wired into Insight Storage, and queried live through the
deployed DSH agent's `query_checkout_events` tool. See [../README.md](../README.md)
for why this lives outside `plugins/` and the general kit-directory
convention, and [docs/PRD-vision-insights.md](../../docs/PRD-vision-insights.md)
§9-10 for the full decision history (event schema, DSH tool surface, and
why no dispatch layer was needed).

Runs the [Automated Self-Checkout](https://github.com/openvinotoolkit/openvino_build_deploy/tree/master/ai_ref_kits/automated_self_checkout)
reference kit's detection/tracking loop headlessly over its bundled sample
video: tracks retail items (banana/bottle/apple/etc.) entering or leaving a
configured zone via person↔object bounding-box intersection, and writes a
structured JSONL events log — the same shape of deliverable
`openvino-queue-kit` produces, from a kit that (unlike that one) has no
headless mode of its own.

## Model

**YOLOv8m, FP16 export only — no INT8 quantization.** Unlike
`openvino-queue-kit`'s NNCF-quantized model, this kit's own code
(`directrun.py::ascd_init()`) just does `model.export(format="openvino",
half=True)`. It uses the full COCO 80-class label set (not just `person`),
since the add/remove logic needs both a `person` box and an `item` box to
compute IOU intersection.

## Why this needed a custom driver (unlike the queue kit)

The upstream kit ships no CLI/headless entrypoint — `directrun.py`'s core
loop, `stream_object_detection()`, is a Gradio generator callback
(`yield gr.skip(), ...`), and `__main__` starts a Gradio web server
(`demo.launch(...)`). `headless_driver.py` in this directory:

- imports `directrun` as a module and drains `stream_object_detection()`
  with a plain for-loop instead of a Gradio server — the generator itself
  needed no changes;
- monkeypatches `directrun.gr.Info` (a no-op outside a Gradio request
  context) and wraps `directrun.plog` (the kit's internal event-logging
  hook) to also append each event to a JSONL file;
- **works around a real bug in the upstream kit**: `ascd_init()` exports
  the OpenVINO IR with `dynamic=False` (static batch=1), but the detection
  loop always calls `model.track(..., batch=2*desired_fps, ...)` — 14 for
  the bundled video — which fails with a shape-mismatch `RuntimeError`
  against a static-batch model. The driver pre-exports the IR with
  `dynamic=True` before calling `ascd_init()`, which then finds the IR
  already on disk and skips its own (broken) export.

None of this touches the vendored, gitignored `repo/` clone — it's all done
from outside via imports and monkeypatching, so re-cloning `repo/` fresh
doesn't lose anything.

## Layout

- `repo/` — **gitignored**, sparse-checkout clone of the upstream kit
  (`ai_ref_kits/automated_self_checkout` only). Not present until you clone
  it (see "Setting up" below).
- `headless_driver.py` — **tracked**. The Gradio-bypassing driver described
  above.
- `run_demo.sh` — **tracked**. Thin wrapper: checks the kit's venv exists,
  then runs `headless_driver.py` through it.

## Setting up

```sh
git clone --filter=blob:none https://github.com/openvinotoolkit/openvino_build_deploy.git repo --no-checkout
cd repo
git sparse-checkout init --cone
git sparse-checkout set ai_ref_kits/automated_self_checkout
git checkout master
cd ai_ref_kits/automated_self_checkout
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

The sample video (`data/example.mp4`, ~75MB) is Git LFS-tracked upstream;
if `git-lfs` isn't installed, fetch the real file directly (same situation
as `openvino-queue-kit` — the upstream repo's `.lfsconfig` disables LFS
smudge by default):

```sh
curl -sL -o data/example.mp4 \
  "https://media.githubusercontent.com/media/openvinotoolkit/openvino_build_deploy/master/ai_ref_kits/automated_self_checkout/data/example.mp4"
```

**Dependency note**: `requirements.txt`'s exact pins (`openvino==2025.2.0`,
`ultralytics==8.3.38`, etc.) had no macOS/Python-3.14 wheels available for
local verification, so that first pass used newer, mutually-compatible
versions instead (`openvino`, `ultralytics`, `torch`, `gradio` latest,
`supervision==0.18.0` pinned — a newer `supervision` breaks the
`PolygonZone` API this kit calls). The exact pinned stack was then verified
for real on the target VM (Debian 12, Python 3.11.2) — installed cleanly
and ran end-to-end, closing out this caveat.

## Running

```sh
bash run_demo.sh                       # full sample video (~30-60s)
bash run_demo.sh --max-iterations 5    # smoke test: stop early
```

Writes
`repo/ai_ref_kits/automated_self_checkout/data/insights/insights.jsonl` and
prints a summary. Verified locally 2026-08-19: 377 events (196 add / 181
remove) from the 21.3s/640-frame sample video in ~30-40s, on newer
mutually-compatible dependency versions (see "Dependency note" above).
Re-verified the same day on `linkhealth-openvino-vision` with the kit's
**exact** pinned dependencies: 335 events (201 add / 134 remove) in 2m34s —
the event-count difference between runs is expected model/dependency-version
variance, not a bug.

## Event schema

```jsonl
{"ts": "2026-08-19T00:04:18", "class": "#8 banana", "action": "add", "message": "1 #8 banana added to zone by person 4", "source": "self-checkout-kit-sim"}
```

| Field | Meaning |
| --- | --- |
| `ts` | local timestamp (kit's own `datetime.now()` — not UTC-normalized, unlike `openvino-queue-kit`'s `ts`) |
| `class` | `"#<tracker_id> <item label>"` (tracker id included; strip the `#N ` prefix for a per-item-type rollup) |
| `action` | `"add"` or `"remove"` |
| `message` | the kit's own human-readable description, including which person id triggered it |
| `source` | always `"self-checkout-kit-sim"` |

**This shape is not compatible with `openvino-queue-kit`'s `events` table**
(item add/remove vs. per-zone occupancy count) — resolved as its own table
(`checkout_events`) rather than a schema merge; see
[docs/PRD-vision-insights.md](../../docs/PRD-vision-insights.md) §9 Q1/Q2
and §10 for the schema and DSH-tool-surface decisions this led to.
