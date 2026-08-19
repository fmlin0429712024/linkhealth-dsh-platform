# infra/openvino-queue-kit

**Status: production data source, verified end-to-end (2026-08-19).** See
[../README.md](../README.md) for why this lives outside `plugins/` and the
general kit-directory convention, and
[docs/PRD-vision-insights.md](../../docs/PRD-vision-insights.md) for the
full architecture this is one half of.

Runs the [Intelligent Queue Management](https://github.com/openvinotoolkit/openvino_build_deploy/tree/master/ai_ref_kits/intelligent_queue_management)
reference kit headless over its bundled sample video: counts people per
configured zone and flags over-capacity, writing a structured JSONL events
log. That log is ingested into the Insight Storage SQLite datastore (see
[../README.md](../README.md)), which `dsh-vision-insights-plugin`'s
`query_vision_events` tool reads — this is the data source behind that
tool's answers in production today.

## Model

**YOLOv8m, INT8-quantized** via NNCF, using COCO val2017 as calibration
data (`repo/ai_ref_kits/intelligent_queue_management/convert_and_optimize.py`
— part of the upstream kit, downloads ~1GB of COCO data on first run). Only
the `person` class is used; detections are matched against the zones in
`config/zones.json` (polygon point lists) to produce a per-zone occupancy
count.

## Layout

- `repo/` — **gitignored**, sparse-checkout clone of the upstream kit
  (`ai_ref_kits/intelligent_queue_management` only). Not present until you
  clone it (see "Setting up" below).
- `run_demo.sh` — **tracked**. One-command headless run + summary; this is
  what's deployed to the VM (`/opt/openvino-queue-kit/`) and invoked there.

## Setting up

```sh
git clone --filter=blob:none https://github.com/openvinotoolkit/openvino_build_deploy.git repo --no-checkout
cd repo
git sparse-checkout init --cone
git sparse-checkout set ai_ref_kits/intelligent_queue_management
git checkout master
cd ai_ref_kits/intelligent_queue_management
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

The sample video (`data/sample_video.mp4`) is Git LFS-tracked upstream; if
`git-lfs` isn't installed, fetch the real file directly (the upstream
repo's `.lfsconfig` disables LFS smudge by default, so a plain clone leaves
a pointer file in its place):

```sh
curl -sL -o data/sample_video.mp4 \
  "https://media.githubusercontent.com/media/openvinotoolkit/openvino_build_deploy/master/ai_ref_kits/intelligent_queue_management/data/sample_video.mp4"
```

## Running

```sh
bash run_demo.sh
```

Runs headless in real time (~51s for the bundled clip), writes
`repo/ai_ref_kits/intelligent_queue_management/data/insights/insights.jsonl`,
and prints a per-zone summary. If a Phase-2 Insight Storage venv is present
at `/opt/vision-insights-store/venv` (only true on the deploy VM), it also
refreshes that SQLite datastore from the fresh log — see the script's own
comments.

## Event schema

```jsonl
{"ts": "2026-08-18T23:37:47.350357Z", "zone": "zone0", "count": 4, "avg_count": 4.0, "capacity": 3, "over_capacity": true, "source": "iqm-kit-sim"}
```

| Field | Meaning |
| --- | --- |
| `ts` | ISO-8601 UTC event time |
| `zone` | configured zone id (`zone0`/`zone1`/`zone2`) |
| `count` | people detected in the zone at sample time |
| `avg_count` | rolling average count |
| `capacity` | configured zone threshold |
| `over_capacity` | `count > capacity`, computed deterministically |
| `source` | always `"iqm-kit-sim"` |
| `event` | present (`"stream_end"`) only on the final row of a run — a run-boundary marker, not a real sample; downstream consumers should skip or separately flag it |

Full details and the decoupled-architecture rationale:
[docs/PRD-vision-insights.md](../../docs/PRD-vision-insights.md) §3-4.
