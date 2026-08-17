-- Synthetic Track A "SOP store" — deterministic rule definitions only.
-- Fictional, illustrative thresholds. Not real clinical, coding, or
-- compliance guidance. See docs/prd-agentic-audit-tracks.md section 5.

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
    'SYN-ICHD-01',
    'Synthetic treatment completed materially earlier than scheduled',
    'scheduled_minutes', 'completed_minutes', 'a_minus_b_gte', '15',
    'Is the reason for early termination and the disposition sufficiently documented for the intended review purpose?',
    'No diagnosis, code, clinical conclusion, or payment implication is inferred.'
),
(
    'SYN-ICHD-09',
    'Synthetic treatment marked as missed',
    'status', NULL, 'eq', 'missed',
    'Is the reason the treatment was missed, and any rescheduling plan, sufficiently documented for the intended review purpose?',
    'No diagnosis, code, clinical conclusion, or payment implication is inferred.'
);
