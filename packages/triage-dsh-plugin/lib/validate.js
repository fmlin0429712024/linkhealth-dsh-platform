// Shared guardrail validation for the LinkHealth intake-triage system.
//
// This is the deterministic backstop: it does not trust the model — it
// re-reads the log file itself and checks the rule in code. It must stay in
// lockstep with `scripts/validate_triage_log.py` (the standalone/parity
// copy) and with SKILL.md Step 3 (the instruction). Keep the rule set in
// exactly these three places.
//
// The rule being enforced:
//   1. a triage record is a JSON object carrying all ten required fields;
//   2. `phi_involved: true`  ⇒  `requires_human_review: true`
//      (the system's one hard stop — PHI-flagged enquiries are never
//      auto-dispatched, regardless of complexity).

import { readFileSync } from 'node:fs'

/** The ten output fields every triage decision must carry (PRD §6). */
export const REQUIRED_FIELDS = [
  'enquiry_id',
  'service_line',
  'complexity_score',
  'complexity',
  'urgency',
  'phi_involved',
  'requires_human_review',
  'needs_manual_triage',
  'routed_to',
  'rationale',
]

/**
 * True when a file path is a `data/triage_log.jsonl` (path-separator
 * agnostic), matching the heuristic the Claude Code hook uses — works no
 * matter where the plugin is installed relative to the workspace.
 */
export function isTriageLogPath(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  return value.replace(/\\/g, '/').endsWith('data/triage_log.jsonl')
}

/**
 * Validate one parsed triage record object.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function validateRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: 'triage record is not a JSON object' }
  }
  const missing = REQUIRED_FIELDS.filter((field) => !(field in record))
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `triage record ${record.enquiry_id ?? '?'} is missing required field(s): ${missing.join(', ')}`,
    }
  }
  if (record.phi_involved === true && record.requires_human_review !== true) {
    return {
      ok: false,
      reason:
        `triage record ${record.enquiry_id} has phi_involved=true but ` +
        `requires_human_review=${JSON.stringify(record.requires_human_review)} — ` +
        'PHI-flagged enquiries must always require human review.',
    }
  }
  return { ok: true }
}

/**
 * Re-read `logPath` from disk and validate its last non-empty line.
 * @param {string} logPath - absolute or workspace-relative path to the log.
 * @returns {{ok: boolean, checked: boolean, reason?: string}}
 *   - `checked: false` when there is nothing to validate (missing file or no
 *     records yet) — those are passes, not violations;
 *   - `ok: false` with `reason` when the last record violates the guardrail.
 */
export function validateLogFile(logPath) {
  let text
  try {
    text = readFileSync(logPath, 'utf8')
  } catch (error) {
    return {
      ok: true,
      checked: false,
      reason: `cannot read ${logPath}: ${error?.code ?? error?.message ?? String(error)}`,
    }
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) {
    return { ok: true, checked: false, reason: 'no records in log yet' }
  }
  let record
  try {
    record = JSON.parse(lines[lines.length - 1])
  } catch (error) {
    return {
      ok: false,
      checked: true,
      reason: `last line of ${logPath} is not valid JSON (${error.message})`,
    }
  }
  const verdict = validateRecord(record)
  return verdict.ok
    ? { ok: true, checked: true }
    : { ok: false, checked: true, reason: verdict.reason }
}
