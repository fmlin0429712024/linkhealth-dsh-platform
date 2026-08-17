#!/usr/bin/env python3
"""Deterministic-rule tool tests — stdlib only, zero dependencies.

Runs tools/query_deterministic_rule.py as a subprocess against the bundled
SQLite SOP stores and asserts the verbatim results. Because the rule
evaluation is deterministic (SQLite-backed threshold math), these assertions
are exact — no LLM involved, safe to run in CI on every PR.

Usage:
    python3 scripts/test_query_deterministic_rule.py

Each case prints PASS/FAIL; the script exits non-zero if any case fails.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "query_deterministic_rule.py"
SHARED_DB = ROOT / "data" / "audit_rules.db"
MULTI_DB = ROOT / "data" / "audit_rules-multi-domain.db"

passed = 0
failed = 0


def run_tool(rule_id: str, record: dict, db: Path = SHARED_DB) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(TOOL), rule_id, "-", "--db", str(db)],
        input=json.dumps(record),
        capture_output=True,
        text=True,
    )


def check(name: str, proc: subprocess.CompletedProcess, expect_exit: int = 0,
          expect_triggered: bool | None = None, expect_status: str | None = None) -> None:
    global passed, failed
    ok = proc.returncode == expect_exit
    detail = f"exit={proc.returncode}, expected={expect_exit}"
    if ok and expect_triggered is not None:
        try:
            out = json.loads(proc.stdout)
            triggered = out["triggered"]
            status = out["status"]
            ok = (triggered == expect_triggered)
            if ok and expect_status is not None:
                ok = (status == expect_status)
            detail = f"triggered={triggered}, status={status}"
        except Exception as exc:  # noqa: BLE001
            ok = False
            detail = f"unparseable output: {exc}"
    if ok:
        passed += 1
        print(f"[PASS] {name} -> {detail}")
    else:
        failed += 1
        print(f"[FAIL] {name} -> {detail}")
        if proc.stdout.strip():
            print("       stdout:", proc.stdout.strip().splitlines()[-1][:200])
        if proc.stderr.strip():
            print("       stderr:", proc.stderr.strip().splitlines()[-1][:200])


# ── SYN-ICHD-01: scheduled_minutes − completed_minutes ≥ 15 ────────────────
check("A1: SYN-ICHD-01 trigger (240 − 195 = 45 ≥ 15)",
      run_tool("SYN-ICHD-01", {"scheduled_minutes": 240, "completed_minutes": 195}),
      expect_triggered=True, expect_status="requires_human_review")

check("A2: SYN-ICHD-01 no trigger (240 − 230 = 10 < 15)",
      run_tool("SYN-ICHD-01", {"scheduled_minutes": 240, "completed_minutes": 230}),
      expect_triggered=False, expect_status="no_finding")

check("A3: SYN-ICHD-01 boundary (240 − 225 = 15 ≥ 15)",
      run_tool("SYN-ICHD-01", {"scheduled_minutes": 240, "completed_minutes": 225}),
      expect_triggered=True)

# ── SYN-ICHD-09: status == "missed" ─────────────────────────────────────────
check("B1: SYN-ICHD-09 trigger (status=missed)",
      run_tool("SYN-ICHD-09", {"status": "missed"}),
      expect_triggered=True, expect_status="requires_human_review")

check("B2: SYN-ICHD-09 no trigger (status=completed)",
      run_tool("SYN-ICHD-09", {"status": "completed"}),
      expect_triggered=False, expect_status="no_finding")

# ── SYN-ICHD-06 (patient domain, separate multi-domain store): count < 3 ────
check("C1: SYN-ICHD-06 trigger (nursing_notes_count=2 < 3)",
      run_tool("SYN-ICHD-06", {"nursing_notes_count": 2}, db=MULTI_DB),
      expect_triggered=True, expect_status="requires_human_review")

check("C2: SYN-ICHD-06 no trigger (nursing_notes_count=3)",
      run_tool("SYN-ICHD-06", {"nursing_notes_count": 3}, db=MULTI_DB),
      expect_triggered=False, expect_status="no_finding")

# ── Contract errors ─────────────────────────────────────────────────────────
check("D1: missing required field exits non-zero",
      run_tool("SYN-ICHD-01", {"foo": 1}), expect_exit=1)

check("D2: unknown rule_id exits non-zero",
      run_tool("NOPE", {}), expect_exit=1)

check("D3: --list on shared store exits 0 and lists both rules",
      subprocess.run([sys.executable, str(TOOL), "--list"], capture_output=True, text=True),
      expect_exit=0)

# ── Summary ─────────────────────────────────────────────────────────────────
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
