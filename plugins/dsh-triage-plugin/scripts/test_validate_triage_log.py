#!/usr/bin/env python3
"""Offline test suite for validate_triage_log.py (this plugin's guardrail backstop).

Adapted from the Claude Code plugin's test_guardrail_hook.py (same case set, same
CLI contract: `validate_triage_log.py path/to/triage_log.jsonl`, exit 0 = pass,
exit 2 = violation) — pointed at this DSH plugin's own script/, since it's a
documented parity copy (see validate_triage_log.py's docstring) rather than the
Claude Code `.claude/hooks/validate_triage_log.py` hook.

Usage: python3 test_validate_triage_log.py
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "validate_triage_log.py"

BASE_RECORD = {
    "enquiry_id": "TEST",
    "service_line": "Process & Workflow Automation",
    "complexity_score": {"integration_depth": 1, "data_sensitivity": 0, "physical_onsite": 0, "org_scale": 0, "total": 1},
    "complexity": "simple",
    "urgency": "medium",
    "phi_involved": False,
    "requires_human_review": False,
    "needs_manual_triage": False,
    "routed_to": "automation-lead",
    "rationale": "test fixture",
}

CASES = [
    ("A: phi=true, review=true -> pass", {**BASE_RECORD, "phi_involved": True, "requires_human_review": True}, 0),
    ("B: phi=true, review=false -> BLOCK", {**BASE_RECORD, "phi_involved": True, "requires_human_review": False}, 2),
    ("C: phi=false, review=false -> pass", {**BASE_RECORD, "phi_involved": False, "requires_human_review": False}, 0),
    ("D: phi=false, review=true -> pass", {**BASE_RECORD, "phi_involved": False, "requires_human_review": True}, 0),
]


def run_case(label: str, record: dict, expected_code: int) -> bool:
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
        f.write(json.dumps(record) + "\n")
        path = f.name

    result = subprocess.run([sys.executable, str(SCRIPT), path], capture_output=True, text=True)
    ok = result.returncode == expected_code
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {label} (exit={result.returncode}, expected={expected_code})")
    if not ok and result.stderr:
        print(f"    stderr: {result.stderr.strip()}")
    return ok


def run_malformed_case() -> bool:
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
        f.write("{not valid json\n")
        path = f.name
    result = subprocess.run([sys.executable, str(SCRIPT), path], capture_output=True, text=True)
    ok = result.returncode == 2
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] E: malformed JSON -> BLOCK (exit={result.returncode}, expected=2)")
    return ok


def run_missing_field_case() -> bool:
    record = dict(BASE_RECORD)
    del record["rationale"]
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
        f.write(json.dumps(record) + "\n")
        path = f.name
    result = subprocess.run([sys.executable, str(SCRIPT), path], capture_output=True, text=True)
    ok = result.returncode == 2
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] F: missing required field -> BLOCK (exit={result.returncode}, expected=2)")
    return ok


def main() -> None:
    results = [run_case(label, record, code) for label, record, code in CASES]
    results.append(run_malformed_case())
    results.append(run_missing_field_case())
    n_pass = sum(results)
    print(f"\n{n_pass}/{len(results)} passed")
    sys.exit(0 if n_pass == len(results) else 1)


if __name__ == "__main__":
    main()
