#!/usr/bin/env python3
"""Deterministic backstop for the LinkHealth intake-triage guardrail (DSH parity copy).

Runs standalone against a triage log: `python3 validate_triage_log.py path/to/triage_log.jsonl`.
It re-reads the file itself (never trusts a caller's claim about its content) and validates
the last line written against the guardrail:

  1. the record is a JSON object carrying all ten required fields;
  2. `phi_involved: true`  ⇒  `requires_human_review: true`.

Exit 0 = pass (or not applicable: missing file / empty log). Exit 2 = violation, printed
to stderr. It does not depend on the model remembering SKILL.md Step 3 — it enforces the
rule in code.

This is the standalone/parity copy. Inside the DSH plugin the same rule set is enforced
in-process by `lib/validate.js` (a `tools/post-execute` backstop blocks invalid writes,
and the `validate-triage-log` tool exposes the check to the model). Keep the rule set in
exactly three places: SKILL.md Step 3, lib/validate.js, and this script.

For Claude Code the original copy also accepts the PostToolUse hook's JSON payload on
stdin (with no argv) and derives the target file from `tool_input.file_path`; that mode
is retained here for parity with `triage-claude-plugin/scripts/validate_triage_log.py`.
"""
import json
import sys
from pathlib import Path

REQUIRED_FIELDS = [
    "enquiry_id",
    "service_line",
    "complexity_score",
    "complexity",
    "urgency",
    "phi_involved",
    "requires_human_review",
    "needs_manual_triage",
    "routed_to",
    "rationale",
]


def fail(message: str) -> None:
    print(f"[guardrail] BLOCKED: {message}", file=sys.stderr)
    sys.exit(2)


def resolve_log_path() -> Path | None:
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return None
    file_path = payload.get("tool_input", {}).get("file_path")
    if not file_path or not file_path.replace("\\", "/").endswith("data/triage_log.jsonl"):
        return None
    return Path(file_path)


def main() -> None:
    log_path = resolve_log_path()
    if log_path is None or not log_path.exists():
        return

    lines = [line for line in log_path.read_text().splitlines() if line.strip()]
    if not lines:
        return

    last_line = lines[-1]
    try:
        record = json.loads(last_line)
    except json.JSONDecodeError as e:
        fail(f"last line of {log_path.name} is not valid JSON ({e})")
        return

    missing = [f for f in REQUIRED_FIELDS if f not in record]
    if missing:
        fail(f"triage record {record.get('enquiry_id', '?')} is missing required field(s): {missing}")
        return

    if record["phi_involved"] is True and record["requires_human_review"] is not True:
        fail(
            f"triage record {record['enquiry_id']} has phi_involved=true but "
            f"requires_human_review={record['requires_human_review']!r} — "
            "PHI-flagged enquiries must always require human review."
        )
        return


if __name__ == "__main__":
    main()
