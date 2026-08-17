---
name: patient-continuity-review
description: Review a synthetic ICHD patient-level nursing note for continuity with the next relevant treatment's documentation (SYN-ICHD-05, non-deterministic, patient domain). Use from audit-rule-evaluation whenever patient.nursing_notes documents a care-plan-relevant change; judge documentation continuity against a narrative use-case description, never a rigid checklist, and never render a clinical conclusion.
allowed-tools: Read(data/**) Read(rules/**)
disallowed-tools: Bash
---

# Patient Continuity Review

**Domain:** patient — owns `patient.nursing_notes`, the patient-level (cross-treatment)
record distinct from any single `clinical_treatments[]` entry. This skill also reads
the one treatment record needed to judge continuity, but the patient-level note is
what it's responsible for triggering and drafting from.

## Purpose

Judge, from a patient-level nursing note and the next relevant treatment record,
whether documentation shows a care-plan-relevant change (e.g. a medication
adjustment) was carried through — using narrative judgment, since there is no
formula for "adequately carried through."

## Use Case

Outside any single treatment session, the care team maintains patient-level
`nursing_notes` — records of medication changes, allergy-history updates, lab
follow-ups, or care-plan discussions. Unlike a treatment_note/follow_up_note,
these aren't tied to one dialysis session. Presentations and appropriate
follow-through vary by patient and context, so there is no fixed checklist for
this review.

Read the triggering `nursing_notes` entry and the next relevant treatment's
`treatment_note`/`follow_up_note`, and judge, in narrative terms, whether the
documentation shows:

1. the change was adequately described — what changed and when,
2. the next relevant treatment record reflects awareness of the change,
3. the change's effect or outcome was followed up, and
4. the physician was notified or escalation was documented, if the situation
   called for it.

Cite the exact language behind each judgment. If a note is silent or
ambiguous on a point, mark it an evidence gap — do not assume it happened.

## Workflow

1. Confirm a `patient.nursing_notes` entry documents a care-plan-relevant
   change (the `SYN-ICHD-05` trigger in `rules/synthetic-audit-rules.md`). If
   no entry qualifies, this skill does not apply.
2. Identify the next relevant treatment: the earliest `clinical_treatments[]`
   entry dated after the nursing note's `note_date`. This is a chronological
   fact used to pick which treatment record to read next — not itself a
   judgment call.
3. Walk the four judgment points above against the nursing note and that
   treatment's `treatment_note`/`follow_up_note`.
4. For each point, record `documented` (with the citation) or
   `evidence_gap`.
5. Draft a finding with status `requires_human_review`:
   - if one or more points are `evidence_gap`, the draft question names
     which points are missing;
   - if all four points are `documented`, the draft question asks the
     reviewer to confirm the documentation is adequate — the skill still
     never confirms this on its own.
6. Hand the finding to a qualified human reviewer.

## Output Contract

Return a traceable draft finding listing each of the four judgment points
with its status and citation (or `not_present`), plus which nursing-note
entry and which treatment date it cross-references. Do not assign a
diagnosis, code, clinical severity, or payment result.

## Guardrails

- Never state whether the change itself was clinically appropriate — only
  whether the documentation gives a reviewer enough information to judge
  that.
- Never assume an undocumented step happened; silence is an evidence gap,
  not compliance.
- Never treat the four judgment points as a checklist to grep for keywords
  — read and judge the actual note text.
- Cite only source fields present in the synthetic gold set: this rule
  requires `patient.nursing_notes`, which only exists in
  `data/synthetic-ichd-patient-goldset-multi-domain.json` — the original
  `data/synthetic-ichd-patient-goldset.json` has no `nursing_notes` field
  and cannot exercise this skill.

## Note on `disallowed-tools: Bash`

Same caveat as the other two non-deterministic skills: this declares intent
that this skill is pure LLM judgment over text. Claude Code's docs describe
`disallowed-tools` as removing a tool from the available pool while the
skill is active, but do not explicitly confirm whether that's a hard block.
Treat it as documented best-effort intent, not a verified sandbox guarantee.

## Note on `Read(data/**)` / `Read(rules/**)` path scoping

Same caveat as the other two non-deterministic skills: path-scoped
`Read(pattern)` inside `allowed-tools` is architecturally implied by Claude
Code's docs but not confirmed with a skills-specific example. Treat this
scoping as best-effort, not a confirmed-working restriction, until tested.
