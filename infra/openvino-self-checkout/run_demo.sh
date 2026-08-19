#!/usr/bin/env bash
# One-command demo: run the automated_self_checkout kit headless over its
# bundled sample video and summarize the resulting insights log.
#
# Mirrors infra/openvino-queue-kit/run_demo.sh's shape for the sibling kit,
# minus that script's SQLite/read-API refresh step — this kit's events are
# not wired into the Insight Storage layer yet (see docs/PRD-vision-insights.md
# Phase 4, open questions Q1/Q2: the event shape here — item add/remove — is
# genuinely different from the queue kit's per-zone occupancy shape, and
# that has to be resolved before this can feed the same datastore).
#
# Assumes the kit's own venv already exists at
# repo/ai_ref_kits/automated_self_checkout/venv (per that kit's own README:
# `python3 -m venv venv && ./venv/bin/pip install -r requirements.txt`,
# from inside that directory) — this script does not create it.
#
# Usage: bash run_demo.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT="$HERE/repo/ai_ref_kits/automated_self_checkout"
VENV_PY="$KIT/venv/bin/python"

if [ ! -x "$VENV_PY" ]; then
  echo "error: $VENV_PY not found — set up the kit's venv first:" >&2
  echo "  cd $KIT && python3 -m venv venv && ./venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

echo "==> Running automated_self_checkout kit (headless) on data/example.mp4 ..."
"$VENV_PY" "$HERE/headless_driver.py" "$@"
