---
name: intake-triage
description: Classifies and routes inbound LinkHealth business enquiries (prospective healthcare-sector clients asking about AI enablement services) by service line, complexity, and urgency. Detects PHI/regulated-data involvement and enforces a human-review guardrail. Use whenever a new enquiry (free-text need + industry + org size + stated urgency) needs to be triaged.
whenToUse: A user submits a new inbound enquiry about LinkHealth's AI-enablement services (raw_text plus industry, org size, and stated urgency) and it needs classification, complexity scoring, and routing. The hub of the LinkHealth intake-triage system.
---

# Intake Triage — LinkHealth

## Scope and boundary

This skill triages **business enquiries directed at LinkHealth** (a one-person AI-enablement
consultancy serving the patient-care domain). It decides which service line an enquiry
belongs to, how complex it looks, and who (which virtual lead) should pick it up next.

It does **not** make clinical decisions, does not triage patients, and must never be
presented as, or repurposed for, clinical decision support. If an enquiry describes a
patient's medical situation rather than an organization's business need, stop and flag
`needs_manual_triage: true` with a note explaining why — do not attempt to classify it.

## Input

An enquiry has four fields:
- `raw_text` — free-text description of what the prospective client needs
- `industry` — the enquirer's organization type (e.g. dental clinic, hospital network, dialysis center)
- `org_size` — headcount or bed count, however the enquirer described it
- `stated_urgency` — low / medium / high, as given by the enquirer (not derived)

## Step 1 — Service line classification

Classify into exactly one of three lines. Do not invent a fourth category, even for a
poor fit — pick the closest of the three and rely on `needs_manual_triage` (Step 4) to
surface weak matches.

| Service line | Covers | Signal words |
|---|---|---|
| **Process & Workflow Automation** | Automating an existing business/administrative process | scheduling, reminders, no-show prediction, prior authorization, claims routing, intake form routing, RPA, chatbots for admin/billing questions |
| **Documentation & Data Analytics** | Turning documents or data into structured output or insight | chart/dictation summarization, coding automation, reporting dashboards, trend analysis, research data pipelines |
| **Onsite Automation & Robotics Deployment** | Physical/hardware automation inside a facility | AGVs, robotic supply/waste transport, autonomous disinfection robots, any request requiring a site visit or hardware install |

## Step 2 — Complexity scoring

Score each dimension 0–2 and sum (0–8 total). This is a fixed rubric — do not eyeball a
bucket without scoring the dimensions; the score is what makes the rationale defensible.

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| `integration_depth` | Standalone, no existing system touched | Integrates with one existing system | Integrates with multiple / legacy systems |
| `data_sensitivity` | No patient-identifiable clinical data referenced | Patient-identifiable data referenced, standard handling | Clinical/health record content, or heightened scope (research, cross-site, cross-border) |
| `physical_onsite` | Fully remote/software | Some onsite configuration | Onsite hardware deployment |
| `org_scale` | Single small practice | Mid-size, multi-location | Large health system / hospital network |

`total` 0–2 → **simple**, 3–5 → **moderate**, 6–8 → **complex**.

`data_sensitivity` is deliberately narrow: general scheduling/admin metadata (a name and
an appointment time) does **not** count. It only scores ≥1 when the request touches
clinical content — diagnoses, treatment notes, lab results, or claims/billing tied to an
identifiable patient. State this assumption in the rationale when it's a close call.

De-identification does **not** by itself pull a case back down to 0–1: research use and
multi-site/cross-border data sharing are scored on scope, not on identifiability alone —
de-identified data shared across sites under a research or data-use agreement still scores
2, because the governance risk (re-identification, data-use terms) doesn't disappear just
because names were stripped.

## Step 3 — PHI / compliance guardrail (mandatory, not optional)

Set `phi_involved: true` whenever `data_sensitivity` scored ≥1 in Step 2. This is a
cross-cutting attribute, not a service line — every line can trigger it.

**Guardrail rule:** if `phi_involved` is true, you MUST set `requires_human_review: true`
regardless of the complexity bucket, and you MUST NOT hand the enquiry off to a spoke
agent for an automatic response. Output the classification, log it (Step 5), and stop —
present it as queued for human compliance sign-off instead of auto-routing.

This is the system's only hard stop. Every other output can be auto-handled; this one
cannot.

## Step 4 — Ambiguity check

If the enquiry doesn't clearly fit the best-guess service line (vague, multi-line, or
too little information to score confidently), set `needs_manual_triage: true` and explain
why in `rationale`. Still fill in a best-guess classification — never leave fields empty.

## Step 5 — Output and logging

Produce exactly this JSON shape:

```json
{
  "enquiry_id": "...",
  "service_line": "Process & Workflow Automation | Documentation & Data Analytics | Onsite Automation & Robotics Deployment",
  "complexity_score": {"integration_depth": 0, "data_sensitivity": 0, "physical_onsite": 0, "org_scale": 0, "total": 0},
  "complexity": "simple | moderate | complex",
  "urgency": "low | medium | high",
  "phi_involved": false,
  "requires_human_review": false,
  "needs_manual_triage": false,
  "routed_to": "automation-lead | data-lead | deployment-lead",
  "rationale": "one to three sentences citing the scoring dimensions that drove the result"
}
```

Then append this JSON as one line to `data/triage_log.jsonl` (create the file if it
doesn't exist) — this is the system's observability trail. Every triage decision must be
logged, including ones that trip the guardrail. Append with the `write` or `edit` tool
— the guardrail backstop covers those; do not append via `bash` (a shell append is not
intercepted by the backstop and must be validated manually).

**After appending, call the `validate-triage-log` tool** to confirm the guardrail passed.
An automatic backstop also blocks invalid writes at the harness level (`tools/post-execute`):
if a write to the log comes back blocked, fix the record — all ten fields present, and
`phi_involved: true` must imply `requires_human_review: true` — and re-append. Never work
around a block; a blocked record means the guardrail caught a real violation.

## Step 6 — Handoff

- If `requires_human_review` is true: stop after logging. Tell the user this enquiry is
  queued for human compliance review and why.
- Otherwise: hand off to the spoke named in `routed_to` (`automation-lead`, `data-lead`,
  or `deployment-lead`) by dispatching a **subagent** with the `subagent`/`subagent_fork`
  tool. The child does not share this conversation, so the delegation prompt must be
  complete and self-contained: include the enquiry's four fields, the full classification
  (service line, complexity score and bucket, urgency, and `routed_to`), the fact that it
  is cleared (`requires_human_review: false`), and the spoke's role instructions — load
  the matching spoke skill (`automation-lead`, `data-lead`, or `deployment-lead`) and
  embed its role text in the delegation prompt so the child acts as that lead.
