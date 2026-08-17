// linkhealth-gui-plugin — pure logic (single source of truth).
//
// This module is the BEHAVIOUR CONTRACT for the front-door data:
//   - capability-list schema + defaults (PRD FR3/FR5)
//   - session-launch parameter building (PRD FR3)
//   - brand token palettes (PRD FR1)
//
// It is unit-tested by test/launcher-config.test.mjs (node:test, zero deps —
// docs/TASKS-gui-plugin.md §2, TDD red → green). The browser half
// (lib/client.js) INLINES the same logic because DSH client bundles are
// self-contained (require() reaches only platform modules, never
// package-internal files) — keep the two in sync; this file's tests are the
// contract the inline copy must satisfy.

/** Config defaults (PRD §7). */
export const DEFAULTS = {
  headline: 'LinkHealth Agents',
  placeholder: 'Triage an enquiry, audit documentation — or describe what you need',
  capabilities: [],
}

/** Brand palette, light scheme: deep teal + deep blue, healthcare-professional. */
const BRAND_LIGHT = {
  '--dsw-alias-brand-primary': '#0E7C7B',
  '--dsw-alias-state-success-primary': '#1F6E6B',
  '--dsw-alias-bg-base': '#F7FAF9',
  '--dsw-alias-bg-overlay': '#FFFFFF',
}

/** Brand palette, dark scheme (same token keys, tuned for dark contrast). */
const BRAND_DARK = {
  '--dsw-alias-brand-primary': '#35B3A8',
  '--dsw-alias-state-success-primary': '#4CC3B8',
  '--dsw-alias-bg-base': '#0F1A1A',
  '--dsw-alias-bg-overlay': '#152220',
}

/**
 * Validate the capability list (PRD §7 contract). Each entry requires
 * string `id`, `label`, `description`; `sessionStart` optional; extra keys
 * are kept for forward compatibility. Empty list is valid.
 * @throws {Error} on malformed entries or non-array input.
 */
export function parseCapabilities(input) {
  if (!Array.isArray(input)) throw new Error('capabilities must be an array')
  return input.map((entry) => {
    if (entry === null || typeof entry !== 'object') {
      throw new Error('capability entry must be an object')
    }
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error('capability entry requires a string id')
    }
    if (typeof entry.label !== 'string' || entry.label.length === 0) {
      throw new Error(`capability ${entry.id} requires a string label`)
    }
    if (typeof entry.description !== 'string') {
      throw new Error(`capability ${entry.id} requires a string description`)
    }
    return { ...entry }
  })
}

/**
 * Merge a partial patch config over the defaults; unknown keys are dropped,
 * present keys win.
 */
export function resolveConfig(partial) {
  const source = partial !== null && typeof partial === 'object' && !Array.isArray(partial) ? partial : {}
  const out = { ...DEFAULTS }
  if (typeof source.headline === 'string') out.headline = source.headline
  if (typeof source.placeholder === 'string') out.placeholder = source.placeholder
  if (source.capabilities !== undefined) out.capabilities = parseCapabilities(source.capabilities)
  return out
}

/**
 * Build the JSON-safe session-launch parameters for a capability entry.
 * No business-plugin knowledge — purely the capability's own config.
 */
export function buildLaunch(capability, workspaceId) {
  return {
    workspaceId: workspaceId ?? null,
    note: `Start ${capability.label} — ${capability.description}`,
  }
}

/**
 * Brand palette for one color scheme: a flat token-name → CSS-color map.
 * The theme service consumes these as `{ light, dark }` pairs per token
 * (`theme.overrideTokens(source, pairs)`); the client half assembles that
 * shape from `brandTokens('light')` + `brandTokens('dark')`.
 * Unknown schemes fall back to light.
 */
export function brandTokens(scheme) {
  if (scheme === 'dark') return { ...BRAND_DARK }
  return { ...BRAND_LIGHT }
}
