---
name: clinical-record-normalization
description: Normalize a synthetic ICHD clinical-documentation gold set into a traceable, audit-ready evidence inventory. Use as the first pipeline step, before documentation-evidence-review. Never use for real patient data or clinical decisions.
allowed-tools: Read(data/**)
---

# Clinical Record Normalization

**Domain:** collaboration — a shared, domain-agnostic first pass. Its
evidence inventory covers both patient-level and treatment-level fields;
which downstream skill uses which part is decided later, by
`audit-rule-evaluation`.

## Purpose

Turn the raw synthetic gold set into a normalized, source-traceable evidence
inventory that downstream skills can cite from — without inferring or
inventing any value the record doesn't contain.

## Workflow

1. Read the synthetic record and preserve its source identifiers.
2. Build an evidence inventory: patient context (including
   `patient.nursing_notes` when present — only in
   `data/synthetic-ichd-patient-goldset-multi-domain.json`), treatment
   context, notes, and audit context.
3. Mark absent fields as `not_present`; never invent values.
4. Carry the synthetic-data notice into the normalized output.
5. Hand the evidence inventory to `documentation-evidence-review`.

## Output Contract

Return a normalized record, source references, an absent-field list, and
`human_review_required: true`.

## Guardrails

- Use only the synthetic gold set in `data/` — never real patient or
  client data.
- Preserve gaps as `not_present`; never fabricate a missing value.
