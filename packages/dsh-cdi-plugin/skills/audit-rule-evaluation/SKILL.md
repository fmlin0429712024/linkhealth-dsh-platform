---
name: audit-rule-evaluation
description: Apply a synthetic ICHD audit rule to cited evidence and draft a traceable finding — dispatching to deterministic-rule-audit (SQLite-backed) for deterministic rules and to the matching use-case skill (e.g. intradialytic-hypotension-review, patient-continuity-review) for non-deterministic ones, by Domain as well as Method. Use as the third pipeline step, after documentation-evidence-review. Never treat outputs as clinical, coding, billing, or compliance decisions.
allowed-tools: Read(rules/**) Read(data/**) Skill Bash(python3 tools/query_deterministic_rule.py *)
---

# Audit Rule Evaluation

**Domain:** collaboration — this skill doesn't own treatment or patient
evidence itself; it reads the rule's Method *and* Domain columns and routes
to whichever skill does.

## Purpose

Resolve a rule's trigger by the mechanism its Method demands — a tool query
for deterministic rules, judgment for non-deterministic ones — and draft a
traceable finding from the result.

## Workflow

1. Read `rules/synthetic-audit-rules.md` and the cited evidence from
   `documentation-evidence-review`.
2. Check the rule's Method column:
   - **deterministic** — do not judge the trigger yourself.
     - Auditing a whole patient (all treatments, all deterministic rules,
       plus the one patient-level check when the multi-domain gold set is
       in use)? Run the `deterministic-rule-audit` skill — it owns the
       loop.
     - Checking a single treatment-domain rule (`SYN-ICHD-01`/`09`)
       against a single treatment? Extract that treatment as JSON and run
       `python3 tools/query_deterministic_rule.py <rule_id> -` (piping the
       treatment JSON on stdin) directly — the result comes from
       `data/audit_rules.db`, the default store.
     - Checking the single patient-domain rule (`SYN-ICHD-06`)? Same tool,
       but it is **not** in the default store — pass
       `--db data/audit_rules-multi-domain.db` explicitly, e.g.
       `python3 tools/query_deterministic_rule.py SYN-ICHD-06 - --db data/audit_rules-multi-domain.db`
       (see that rule's row in `rules/synthetic-audit-rules.md`).
     Either way, report the tool's result verbatim.
   - **non-deterministic** — apply judgment against the cited evidence and
     the rule's narrative use-case description, using whichever skill owns
     that rule's Domain. For `SYN-ICHD-04` (treatment), run the
     `intradialytic-hypotension-review` skill; for `SYN-ICHD-02`
     (treatment), run the `treatment-refusal-review` skill; for
     `SYN-ICHD-05` (patient), run the `patient-continuity-review` skill —
     which requires `data/synthetic-ichd-patient-goldset-multi-domain.json`,
     not the original gold set (see that rule's row in
     `rules/synthetic-audit-rules.md`). Either way, don't judge inline —
     the dispatched skill owns the full judgment and drafts its own
     finding.
3. Draft a finding only when the evidence (or tool result) supports its
   question.
4. Include trigger, evidence, evidence gaps, and prohibited inferences.
5. Set status to `requires_human_review`.

## Output Contract

Return a traceable draft finding. Do not assign a diagnosis, code, clinical
severity, or payment result.

## Guardrails

- Deterministic rules: never reason about the threshold yourself — the
  tool's result is final.
- Non-deterministic rules: never treat the narrative use-case description
  as a checklist to pattern-match against.
- Cite only source fields present in the synthetic gold set.
