#!/usr/bin/env bash
# One-command demo: run the Intelligent Queue Management kit headless over the
# bundled sample video and summarize the insights log.
#
# Everything is local at runtime (OpenVINO INT8 model IR + sample video +
# JSONL insights log) — no camera, no external API.
#
# Usage: sudo bash run_demo.sh   (or: bash run_demo.sh)
set -euo pipefail

KIT=/opt/openvino-queue-kit/repo/ai_ref_kits/intelligent_queue_management
cd "$KIT"
LOG=data/insights/insights.jsonl

rm -f "$LOG"
echo "==> Running IQM kit (headless) on data/sample_video.mp4 (~51s, real-time) ..."
./venv/bin/python app.py \
  --stream data/sample_video.mp4 \
  --model_path model/yolov8m_openvino_int8_model/yolov8m.xml \
  --zones_config_file config/zones.json \
  --customers_limit 3 \
  --headless \
  --insights_log "$LOG" \
  --log_interval 15

echo "==> Insights log: $LOG"
echo "    lines: $(wc -l < "$LOG")"
echo "==> Per-zone summary:"
./venv/bin/python - "$LOG" <<'PY'
import json, sys, collections
path = sys.argv[1]
zones = collections.defaultdict(lambda: {"events": 0, "over": 0, "max_count": 0})
try:
    for line in open(path):
        e = json.loads(line)
        if e.get("event") == "stream_end":
            continue
        z = zones[e["zone"]]
        z["events"] += 1
        z["over"] += int(e["over_capacity"])
        z["max_count"] = max(z["max_count"], e["count"])
except FileNotFoundError:
    print("    (log not found)")
    sys.exit(1)
for zone, z in sorted(zones.items()):
    print(f"    {zone}: events={z['events']} over_capacity={z['over']} max_count={z['max_count']}")
print("==> demo complete (self-contained, no external support)")
PY
