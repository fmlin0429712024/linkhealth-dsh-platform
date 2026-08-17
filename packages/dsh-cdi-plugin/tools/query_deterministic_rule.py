#!/usr/bin/env python3
"""Track A tool: look up a deterministic rule from data/audit_rules.db and
evaluate it against one synthetic treatment record. Stdlib only.

The audit-rule-evaluation skill calls this for any rule marked
'deterministic' in rules/synthetic-audit-rules.md instead of judging the
threshold itself — the LLM's job is to invoke the tool and report its
result, not to decide the outcome.

Usage:
    query_deterministic_rule.py SYN-ICHD-01 treatment.json
    query_deterministic_rule.py SYN-ICHD-01 -            # treatment JSON on stdin
    query_deterministic_rule.py --list                   # show all known rules

Deliberately single-purpose: one rule against one treatment per call. The
loop over a patient's clinical_treatments[] and the rule catalog lives in
the deterministic-rule-audit skill, not in this script — the agent does
the iterating, this tool only ever answers one (rule, treatment) question.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "audit_rules.db"


def op_a_minus_b_gte(rule: dict, treatment: dict) -> bool:
    a = float(treatment[rule["field_a"]])
    b = float(treatment[rule["field_b"]])
    return (a - b) >= float(rule["threshold"])


def op_eq(rule: dict, treatment: dict) -> bool:
    return str(treatment[rule["field_a"]]) == str(rule["threshold"])


def op_lt(rule: dict, treatment: dict) -> bool:
    return float(treatment[rule["field_a"]]) < float(rule["threshold"])


OPERATORS = {
    "a_minus_b_gte": op_a_minus_b_gte,
    "eq": op_eq,
    "lt": op_lt,
}


def load_rule(rule_id: str, db_path: Path = DB_PATH) -> dict:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT * FROM deterministic_rules WHERE rule_id = ?", (rule_id,)
    ).fetchone()
    conn.close()
    if row is None:
        raise SystemExit(f"Unknown rule_id: {rule_id}")
    return dict(row)


def list_rules(db_path: Path = DB_PATH) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM deterministic_rules ORDER BY rule_id").fetchall()
    conn.close()
    return [dict(row) for row in rows]


def evaluate(rule: dict, treatment: dict) -> dict:
    operator = OPERATORS.get(rule["operator"])
    if operator is None:
        raise SystemExit(f"Unsupported operator: {rule['operator']}")
    triggered = operator(rule, treatment)
    return {
        "rule_id": rule["rule_id"],
        "method": "deterministic",
        "triggered": triggered,
        "trigger_description": rule["description"],
        "status": "requires_human_review" if triggered else "no_finding",
        "draft_question": rule["draft_question"] if triggered else None,
        "prohibited_inference": rule["prohibited_inference"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rule_id", nargs="?")
    parser.add_argument("treatment_json", nargs="?", help="Path to treatment JSON, or '-' for stdin")
    parser.add_argument("--list", action="store_true", help="List all deterministic rules and exit")
    parser.add_argument(
        "--db",
        type=Path,
        default=DB_PATH,
        help=(
            "SOP store to query. Defaults to data/audit_rules.db (the "
            "original, shared store — Phase 1 and Phase 2 both rely on its "
            "exact rule set, so it's never extended). Phase 1.5's "
            "patient-domain deterministic rules live in a separate store, "
            "data/audit_rules-multi-domain.db, passed explicitly here."
        ),
    )
    args = parser.parse_args()

    if args.list:
        print(json.dumps(list_rules(args.db), indent=2))
        return

    if not args.rule_id or not args.treatment_json:
        parser.error("rule_id and treatment_json are required unless --list is given")

    rule = load_rule(args.rule_id, args.db)

    if args.treatment_json == "-":
        treatment = json.load(sys.stdin)
    else:
        treatment = json.loads(Path(args.treatment_json).read_text())

    print(json.dumps(evaluate(rule, treatment), indent=2))


if __name__ == "__main__":
    main()
