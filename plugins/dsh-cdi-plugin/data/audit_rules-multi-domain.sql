-- Phase 1.5 patient-domain deterministic "SOP store" — kept as a SEPARATE
-- database from data/audit_rules.db on purpose, for the same reason
-- data/synthetic-ichd-patient-goldset-multi-domain.json is a separate file
-- from the original gold set: data/audit_rules.db is referenced (not
-- copied) by Phase 1 skills and Phase 2 (claude-sdk-audit/), whose
-- behavior/tests are pinned to its exact two-row rule set
-- (SYN-ICHD-01, SYN-ICHD-09). Adding a row there would silently change
-- what Phase 2's deterministic.py loops over. This file only ever holds
-- patient-domain rules, queried via `tools/query_deterministic_rule.py
-- <rule_id> - --db data/audit_rules-multi-domain.db`.
--
-- Fictional, illustrative thresholds. Not real clinical, coding, or
-- compliance guidance. See docs/prd-multi-agent-domain-split.md.

CREATE TABLE IF NOT EXISTS deterministic_rules (
    rule_id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    field_a TEXT NOT NULL,
    field_b TEXT,
    operator TEXT NOT NULL,
    threshold TEXT NOT NULL,
    draft_question TEXT NOT NULL,
    prohibited_inference TEXT NOT NULL
);

DELETE FROM deterministic_rules;

INSERT INTO deterministic_rules (
    rule_id, description, field_a, field_b, operator, threshold,
    draft_question, prohibited_inference
) VALUES
(
    'SYN-ICHD-06',
    'Synthetic patient record has fewer than 3 documented nursing_notes entries — care-plan documentation on file may be sparse',
    'nursing_notes_count', NULL, 'lt', '3',
    'Is the sparse nursing-note documentation for this patient consistent with actual care-plan activity, or does the record need to be completed?',
    'No diagnosis, code, clinical conclusion, or payment implication is inferred.'
);
