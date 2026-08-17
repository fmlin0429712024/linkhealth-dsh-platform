# Demo Prompts — dsh-triage-plugin

Three ready-to-paste prompts for testing / demonstrating the intake-triage
pipeline, in the recommended order. Paste one into any DSH session running a
profile with this plugin installed (e.g. the default `web` profile at
`http://127.0.0.1:3080`).

Run them in order: **1 (full flow) → 2 (guardrail trip) → 3 (hard block)**.

---

## 1 · Full flow (auto-routed, no guardrail)

```
Use the intake-triage skill to process this enquiry end to end (classify → score
→ PHI guardrail → log → route) and write the decision to data/triage_log.jsonl:

- raw_text: We are a small dental practice losing a lot of revenue to no-shows.
  Can you help us send automated appointment reminders and predict which
  patients are likely to skip their appointments? We currently use a basic
  scheduling app.
- industry: Dental clinic
- org_size: 12 staff
- stated_urgency: medium

When done, report: service_line, complexity, phi_involved, requires_human_review, routed_to.
Respond in English.
```

**Expected**: Process & Workflow Automation / simple / phi=false / no guardrail
trip / routed to automation-lead — demonstrates the fully automatic loop.

---

## 2 · Guardrail trip (PHI → human review, no dispatch)

```
Use the intake-triage skill to process this enquiry end to end and write the
decision to data/triage_log.jsonl:

- raw_text: Our prior-authorization process is a mess — staff manually re-key
  requests into three different insurance portals from our EHR. We want this
  automated end to end.
- industry: Regional hospital network
- org_size: 450 beds
- stated_urgency: medium

When done, report: service_line, complexity, phi_involved, requires_human_review,
and whether dispatch was blocked (must NOT auto-dispatch).
Respond in English.
```

**Expected**: Process & Workflow Automation / complex (6) / phi=true →
requires_human_review=true / **no dispatch, queued for human review** —
demonstrates the hard guardrail stop.

---

## 3 · Hard block (backstop rejects a violating write)

```
Use the edit tool to append the following record to data/triage_log.jsonl (do not modify existing content — append only):

{"enquiry_id": "BAD-1", "service_line": "Documentation & Data Analytics", "complexity_score": {"integration_depth": 1, "data_sensitivity": 2, "physical_onsite": 0, "org_scale": 1, "total": 2}, "complexity": "simple", "urgency": "medium", "phi_involved": true, "requires_human_review": false, "needs_manual_triage": false, "routed_to": "data-lead", "rationale": "test"}

Respond in English.
```

**Expected**: the write is blocked with **`[guardrail] BLOCKED`** (phi=true but
requires_human_review=false) — verifies the `tools/post-execute` backstop works
on the VM too.

> Note: this record deliberately violates the rule. After the test, fix or
> remove the bad record from the log to keep it valid.
> Why "edit tool": the `tools/post-execute` backstop blocks violating
> `write`/`edit` calls — a bash append bypasses that tool-level guard (by
> design, same as the Claude Code hook); this prompt exists to show the
> immediate BLOCKED on the controlled path.
