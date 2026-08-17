---
name: documentation-evidence-review
description: Review a normalized synthetic ICHD record for explicit evidence relevant to a candidate audit question. Use as the second pipeline step, after clinical-record-normalization and before audit-rule-evaluation. Identify evidence gaps without inferring diagnoses, codes, causality, or payment impact.
allowed-tools: Read(data/**) Read(rules/**)
---

# Documentation Evidence Review

**Domain:** treatment — currently invoked for treatment-track evidence
(`SYN-ICHD-01/02/04/09`). `SYN-ICHD-05` (patient domain) is handled
separately by `patient-continuity-review`, which reads `patient.nursing_notes`
directly rather than going through this skill.

## Purpose

Extract only explicit, citable evidence relevant to a candidate audit
question from the normalized record — surface gaps, never infer past them.

## Workflow

1. Read the normalized evidence inventory from `clinical-record-normalization`.
2. Extract only explicit statements relevant to the requested rule.
3. Cite note type and source field for every statement.
4. Label missing support as `insufficient_evidence`.
5. Send evidence and gaps to `audit-rule-evaluation`.

## Output Contract

Return cited evidence statements, an `insufficient_evidence` list, and no
clinical conclusion.

## Guardrails

- Draft questions, not clinical conclusions.
- A qualified human reviewer owns interpretation.
