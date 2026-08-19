#!/usr/bin/env python3
"""Headless driver for the automated_self_checkout kit's detection/tracking
loop — adapts it to this repo's "run once, write structured JSONL events"
pattern (see docs/PRD-vision-insights.md Phase 4, and
infra/openvino-queue-kit/run_demo.sh for the sibling kit's version of this).

directrun.py's core loop (`stream_object_detection`) is written as a Gradio
generator callback with no CLI/headless entrypoint of its own — see the PRD
for why. Rather than patching the vendored, gitignored `repo/` clone in
place, this driver imports it as a module and neutralizes its two
Gradio-only touchpoints (`gr.Info`, and `plog` — wrapped, not replaced, so
the kit's own log table still gets every row) instead of editing the
upstream file. `stream_object_detection` itself needs no changes: its
Gradio-shaped `yield`s are simply drained by a plain for-loop instead of a
Gradio server.

Usage (from this directory, with the kit's venv active):
  python headless_driver.py \
      --insights-log data/insights/insights.jsonl

  # smoke test: stop after a handful of detection batches instead of the
  # full video
  python headless_driver.py --max-iterations 5
"""
import argparse
import collections
import json
import os
import sys
from pathlib import Path

KIT_DIR = Path(__file__).parent / "repo" / "ai_ref_kits" / "automated_self_checkout"
SOURCE_TAG = "self-checkout-kit-sim"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", default=None, help="input video path (default: the kit's bundled data/example.mp4)")
    parser.add_argument("--insights-log", default=None, help="output JSONL path (default: <kit>/data/insights/insights.jsonl, matching infra/openvino-queue-kit's convention — inside the gitignored repo/ tree, not this script's own directory)")
    parser.add_argument("--max-iterations", type=int, default=None, help="stop after N yields from stream_object_detection (smoke-test / short runs — full video keeps going until end-of-stream)")
    args = parser.parse_args()

    if not KIT_DIR.exists():
        sys.exit(f"kit not found at {KIT_DIR} — clone it first (see docs/PRD-vision-insights.md Phase 4)")

    sys.path.insert(0, str(KIT_DIR))
    os.chdir(KIT_DIR)  # ascd_init()/get_sample_videos() resolve "./data", "./model", "./config" relative to cwd

    import directrun  # noqa: E402 (sys.path must be set up first)

    directrun.gr.Info = lambda msg: print(f"[info] {msg}", file=sys.stderr)

    log_path = Path(args.insights_log) if args.insights_log else KIT_DIR / "data" / "insights" / "insights.jsonl"
    if not log_path.is_absolute():
        log_path = KIT_DIR / log_path
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text("")  # start fresh, mirrors queue-kit's run_demo.sh `rm -f "$LOG"`

    real_plog = directrun.plog

    def plog_and_emit(logtable, message, pclass, pop):
        real_plog(logtable, message, pclass, pop)
        if message is None or logtable is None or not logtable:
            return
        row = logtable[0]  # plog() inserts each new row at index 0
        event = {
            "ts": row["time"],
            "class": row["class"],
            "action": row["action"],
            "message": row["message"],
            "source": SOURCE_TAG,
        }
        with open(log_path, "a") as f:
            f.write(json.dumps(event) + "\n")

    directrun.plog = plog_and_emit

    # ascd_init() exports the OpenVINO IR itself if it isn't already on disk
    # (`det_model.export(format="openvino", dynamic=False, half=True)`) —
    # but a *static* (dynamic=False) export only accepts batch=1 inputs,
    # while stream_object_detection() always calls model.track(...,
    # batch=2*desired_fps, ...) — 14 for this kit's default SUBSAMPLE=4,
    # sample-video fps. That mismatch is a real bug in the vendored kit
    # itself (reproduced 2026-08-19 against a fresh model/ dir: "Can't set
    # the input tensor ... shape=[1,3,640,640] ... tensor (shape=(14,3,640,640))
    # are incompatible"), not something this driver introduces. Work around
    # it by pre-exporting with dynamic=True ourselves; ascd_init() then finds
    # the IR already on disk and skips its own (static) export.
    DET_MODEL_NAME = "yolov8m"
    ov_model_path = KIT_DIR / "model" / f"{DET_MODEL_NAME}_openvino_model" / f"{DET_MODEL_NAME}.xml"
    if not ov_model_path.exists():
        print("Pre-exporting OpenVINO IR with dynamic=True (works around a static-batch export/inference mismatch in directrun.py) ...")
        models_dir = KIT_DIR / "model"
        models_dir.mkdir(exist_ok=True)
        det_model = directrun.YOLO(models_dir / f"{DET_MODEL_NAME}.pt")
        det_model.export(format="openvino", dynamic=True, half=True)

    print("Initializing model/zone/labels (ascd_init) ...")
    demo = directrun.ascd_init()
    if demo is None:
        sys.exit("ascd_init() failed")

    video_path = args.video or str(directrun.get_first_sample_video())
    print(f"Running headless over {video_path} ...")

    iterations = 0
    for _ in directrun.stream_object_detection(video_path):
        iterations += 1
        if args.max_iterations and iterations >= args.max_iterations:
            print(f"Stopping after {iterations} iterations (--max-iterations)")
            break

    for leftover in KIT_DIR.glob("output_*.mp4"):
        leftover.unlink()  # annotated preview clips the kit writes as a side effect — not our output, don't keep them

    events = [json.loads(line) for line in open(log_path)] if log_path.exists() else []
    print(f"Done. {len(events)} events written to {log_path}")
    by_action = collections.Counter(e["action"] for e in events)
    by_item = collections.Counter(e["class"].split(maxsplit=1)[-1] if " " in e["class"] else e["class"] for e in events)  # strip the "#<tracker_id>" prefix for the summary
    print(f"==> by action: {dict(by_action)}")
    print(f"==> by item class: {dict(by_item)}")


if __name__ == "__main__":
    main()
