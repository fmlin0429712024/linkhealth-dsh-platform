---
name: intradialytic-hypotension-review
description: Review synthetic ICHD treatment notes for documentation of an intradialytic symptomatic hypotension event (SYN-ICHD-04, non-deterministic). Use from audit-rule-evaluation whenever a treatment_note documents a hypotension event; judge documentation completeness against a narrative use-case description, never a rigid checklist, and never render a clinical conclusion.
allowed-tools: Read(data/**) Read(rules/**)
disallowed-tools: Bash
---

# Intradialytic Hypotension Review

**Domain:** treatment — reads a single `clinical_treatments[]` entry's
`treatment_note`/`follow_up_note`; does not cross-reference other
treatments or patient-level fields.

## Purpose

Judge, from free-text treatment notes, whether documentation of a synthetic
hypotension event gives a reviewer enough evidence to assess it — using
narrative judgment, since there is no formula for "adequately documented."

## Use Case

During in-center hemodialysis, a patient may develop symptomatic
hypotension — a blood pressure drop with symptoms such as dizziness,
nausea, or lightheadedness. Presentations and appropriate responses vary
by patient and context, so there is no fixed checklist for this review.

Read `treatment_note` and `follow_up_note` for the treatment and judge, in
narrative terms, whether the documentation shows:

1. the blood pressure drop and symptoms were recognized and recorded,
2. some corrective action was taken,
3. the patient's status was reassessed after that action, and
4. the physician was notified if the condition did not resolve.

Cite the exact language behind each judgment. If a note is silent or
ambiguous on a point, mark it an evidence gap — do not assume it happened.

## Workflow

1. Confirm `treatment_note` documents a hypotension-type event (the
   `SYN-ICHD-04` trigger in `rules/synthetic-audit-rules.md`). If not
   present, this skill does not apply to the treatment.
2. Walk the four judgment points above against the cited note text.
3. For each point, record `documented` (with the citation) or
   `evidence_gap`.
4. Draft a finding with status `requires_human_review`:
   - if one or more points are `evidence_gap`, the draft question names
     which points are missing;
   - if all four points are `documented`, the draft question asks the
     reviewer to confirm the documentation is adequate — the skill still
     never confirms this on its own.
5. Hand the finding to a qualified human reviewer.

## Output Contract

Return a traceable draft finding listing each of the four judgment points
with its status and citation (or `not_present`). Do not assign a
diagnosis, code, clinical severity, or payment result.

## Guardrails

- Never state whether the clinical response itself was medically correct —
  only whether the documentation gives a reviewer enough information to
  judge that.
- Never assume an undocumented step happened; silence is an evidence gap,
  not compliance.
- Never treat the four judgment points as a checklist to grep for keywords
  — read and judge the actual note text.

## Note on `disallowed-tools: Bash`

This declares intent — this skill is pure LLM judgment over text, it should
never need to execute code. Claude Code's docs describe `disallowed-tools`
as removing a tool from the available pool while the skill is active, but
do not explicitly confirm whether that is a hard block (the call is
refused) or a softer restriction. Treat it as documented best-effort
intent, not a verified sandbox guarantee. A verified hard guarantee that
this judgment path can never execute code requires Part 2 — controlling
the tool list passed to the model directly via the Claude Agent SDK.

## Note on `Read(data/**)` / `Read(rules/**)` path scoping

Claude Code's docs confirm bare `Read` (no parentheses) pre-approves
reading any file. Path-scoped `Read(pattern)` inside a skill's
`allowed-tools` is not shown with an explicit example in the skill docs —
it's architecturally implied (the docs say `allowed-tools` uses the same
rule format as permission rules, and `Read(path)` is documented there) but
not confirmed with a skills-specific example. Treat this scoping as
best-effort, not a confirmed-working restriction, until tested.
