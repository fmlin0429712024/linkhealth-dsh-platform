---
name: clinical-audit-orchestrator
description: Orchestrate the full synthetic ICHD audit pipeline end to end — normalization, evidence review, Method- and Domain-dispatched rule evaluation, human review, and evaluation feedback. Use as the top-level entry point to demonstrate the whole governed agentic workflow in this POC; never execute against real patient or client data.
allowed-tools: Read(data/**) Skill
---

# Clinical Audit Orchestrator

**Domain:** collaboration — sequences across all domains; owns no evidence
of its own. Treatment-domain rules (`SYN-ICHD-01/02/04/09`) run through all
four steps below, including `documentation-evidence-review`. Patient-domain
rules (`SYN-ICHD-05`/`06`) skip that step: `patient-continuity-review` and
`deterministic-rule-audit`'s patient-level check both read
`patient.nursing_notes` directly, the same way every non-deterministic
skill in this repo reads its own source fields directly rather than
consuming a pre-filtered evidence set. This is a deliberate scope
narrowing of `documentation-evidence-review` to the treatment domain — see
that skill's own Domain note, which states the same thing.

## Purpose

Sequence the full pipeline and enforce the human-review gate — this skill
never decides an outcome itself, only routes to the skill/tool that does.

## Workflow

1. Run `clinical-record-normalization` on the synthetic gold set. To
   exercise `SYN-ICHD-05`/`06` (patient domain), use
   `data/synthetic-ichd-patient-goldset-multi-domain.json` — the original
   `data/synthetic-ichd-patient-goldset.json` has no `patient.nursing_notes`
   and cannot trigger either rule.
2. For treatment-domain rules, run `documentation-evidence-review` for the
   candidate audit question. Patient-domain rules (`SYN-ICHD-05`/`06`)
   skip this step — the skills that own them read `patient.nursing_notes`
   directly.
3. Run `audit-rule-evaluation`, which dispatches by Method **and Domain** —
   `deterministic-rule-audit` (SQLite-backed) for deterministic rules
   (treatment: `SYN-ICHD-01`/`09`; patient: `SYN-ICHD-06`, a separate SOP
   store), the matching use-case skill for non-deterministic ones
   (treatment domain: `intradialytic-hypotension-review`,
   `treatment-refusal-review`; patient domain: `patient-continuity-review`
   for `SYN-ICHD-05`).
4. Route the output to a qualified human reviewer.
5. Record reviewer feedback as an evaluation signal; never change a rule
   or policy automatically.

## Output Contract

Return the finding produced by `audit-rule-evaluation`, routed to a human
reviewer, plus a recorded evaluation signal once reviewed.

## Guardrails

- Do not access real patient or client data.
- Do not make clinical, coding, coverage, billing, or payment decisions.
- Do not treat synthetic rules as policy.
- Preserve evidence traceability and human accountability.
- Stop and label the record `insufficient_evidence` when source evidence
  is absent, contradictory, or outside the synthetic scope.
