---
name: deterministic-rule-audit
description: Audit every clinical_treatments[] entry for a synthetic ICHD patient against every treatment-domain deterministic rule (SYN-ICHD-01, SYN-ICHD-09) in the SQLite SOP store, by calling the cdi_query_rule tool once per (rule, treatment) pair (fallback: tools/query_deterministic_rule.py — same contract) — plus, when the multi-domain gold set is in use, one patient-level check for the deterministic patient-domain rule (SYN-ICHD-06). Use from audit-rule-evaluation, or directly, whenever a full deterministic pass over a patient is needed — not just one rule/treatment lookup. Never judges a threshold itself; the tool's result is always final.
allowed-tools: Read(data/**) Bash(python3 tools/query_deterministic_rule.py *)
---

# Deterministic Rule Audit

**Domain:** treatment (primary) + patient (one additional check, Phase 1.5).
Every treatment-domain rule (`SYN-ICHD-01`, `SYN-ICHD-09`) evaluates a
`clinical_treatments[]` entry and loops per pair, exactly as before. The one
patient-domain deterministic rule (`SYN-ICHD-06`) is *not* looped — it's a
single check against the whole patient record, from a **separate** SOP
store (`data/audit_rules-multi-domain.db`, not `data/audit_rules.db` — see
step 4).

## Purpose

Give every deterministic rule a chance to fire against every treatment for
a patient — the agent does the looping, `tools/query_deterministic_rule.py`
does the (LLM-free) computing. This is the batch counterpart to a single
ad-hoc rule/treatment check.

## Workflow

1. Get the treatment-domain rule catalog: run `cdi_list_rules` (preferred
   when the dsh-cdi-plugin is installed), or fall back to
   `python3 tools/query_deterministic_rule.py --list` (defaults to
   `data/audit_rules.db` — `SYN-ICHD-01`/`09` only; this store is shared
   with Phase 1/2 and never gains new rows).
2. Get the patient's `clinical_treatments[]` (from `clinical-record-normalization`
   output, or the gold set directly for a standalone run).
3. For each treatment, for each rule from step 1: extract that treatment
   as JSON and run `cdi_query_rule` with `{ ruleId, record, store }`
   (preferred when the dsh-cdi-plugin is installed), or fall back to
   `python3 tools/query_deterministic_rule.py <rule_id> -` (piped on
   stdin). This is a real loop of tool calls — do not skip
   pairs, do not summarize without checking each one.
4. If the record being audited is
   `data/synthetic-ichd-patient-goldset-multi-domain.json` (i.e. it has a
   `patient.nursing_notes` field), also run the one patient-domain check:
   count the entries in `patient.nursing_notes`, build a minimal JSON
   object `{"nursing_notes_count": <count>}`, and run `cdi_query_rule`
   with `{ ruleId: "SYN-ICHD-06", record, store: "multi-domain" }`
   (preferred when the dsh-cdi-plugin is installed), or fall back to
   `python3 tools/query_deterministic_rule.py SYN-ICHD-06 - --db data/audit_rules-multi-domain.db`
   piping that object. This is a single check per patient, not a loop.
5. For every result with `"triggered": true`, draft a finding using that
   result's `trigger_description`, `draft_question`, and
   `prohibited_inference` verbatim, citing the treatment date and rule ID
   (or, for `SYN-ICHD-06`, citing the patient record and the computed
   count instead of a treatment date).
6. Set every drafted finding's status to `requires_human_review`.

## Output Contract

Return one draft finding per triggered (rule, treatment) pair — plus the
patient-level `SYN-ICHD-06` result when applicable — each citing its
source, plus a short tally of how many checks were performed and how many
triggered. Do not assign a diagnosis, code, clinical severity, or payment
result.

## Guardrails

- Never compute or judge a threshold inline — every verdict must come
  verbatim from the SQLite-backed tool (`cdi_query_rule`, or
  `tools/query_deterministic_rule.py` as fallback).
- Audit every treatment for the patient, not a hand-picked one — a clean
  audit means every pair was checked and none triggered, not that only
  the obvious ones were checked.
- If a rule's required field is missing from a treatment, the tool call
  will fail — record that pair as `not_present`/not applicable rather
  than guessing a value to force an answer.
