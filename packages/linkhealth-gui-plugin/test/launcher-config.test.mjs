// Unit tests for linkhealth-gui-plugin pure logic (docs/TASKS-gui-plugin.md §2).
// Zero dependencies: node:test + node:assert. Run: node --test test/
//
// These tests are the BEHAVIOUR CONTRACT for the launcher/brand logic. The
// browser half (lib/client.js) inlines the same logic because DSH client
// bundles are self-contained (require() can only reach platform modules, not
// package-internal files) — keep the two in sync, and treat this file as the
// contract the inline copy must satisfy.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULTS,
  parseCapabilities,
  resolveConfig,
  buildLaunch,
  brandTokens,
} from '../lib/launcher-config.js'

const VALID = [
  { id: 'triage', label: 'Triage', description: 'Route inbound enquiries.' },
  { id: 'cdi', label: 'CDI Audit', description: 'Audit documentation.' },
]

// ── 2.1 parseCapabilities: schema validation ───────────────────────────────

test('parseCapabilities: valid list passes through normalized', () => {
  const out = parseCapabilities(VALID)
  assert.equal(out.length, 2)
  assert.equal(out[0].id, 'triage')
  assert.equal(out[1].label, 'CDI Audit')
})

test('parseCapabilities: empty list is valid', () => {
  assert.deepEqual(parseCapabilities([]), [])
})

test('parseCapabilities: throws on non-array input', () => {
  assert.throws(() => parseCapabilities('nope'), /capabilities must be an array/i)
  assert.throws(() => parseCapabilities(undefined), /capabilities must be an array/i)
})

test('parseCapabilities: entry without id throws', () => {
  assert.throws(() => parseCapabilities([{ label: 'X', description: 'd' }]), /id/i)
})

test('parseCapabilities: entry with non-string id throws', () => {
  assert.throws(() => parseCapabilities([{ id: 42, label: 'X', description: 'd' }]), /id/i)
})

test('parseCapabilities: entry without label throws', () => {
  assert.throws(() => parseCapabilities([{ id: 'x', description: 'd' }]), /label/i)
})

test('parseCapabilities: entry with non-string description throws', () => {
  assert.throws(() => parseCapabilities([{ id: 'x', label: 'X', description: 7 }]), /description/i)
})

test('parseCapabilities: unknown extra keys are kept (forward-compatible)', () => {
  const out = parseCapabilities([{ id: 'x', label: 'X', description: 'd', future: 1 }])
  assert.equal(out[0].future, 1)
})

// ── 2.2 resolveConfig: defaults merge ──────────────────────────────────────

test('resolveConfig: undefined -> defaults', () => {
  assert.equal(resolveConfig(undefined).headline, DEFAULTS.headline)
  assert.deepEqual(resolveConfig(undefined).capabilities, [])
})

test('resolveConfig: empty object -> defaults', () => {
  const out = resolveConfig({})
  assert.equal(out.headline, DEFAULTS.headline)
  assert.equal(out.placeholder, DEFAULTS.placeholder)
})

test('resolveConfig: partial overrides only its own keys', () => {
  const out = resolveConfig({ headline: 'Custom' })
  assert.equal(out.headline, 'Custom')
  assert.equal(out.placeholder, DEFAULTS.placeholder)
})

test('resolveConfig: capabilities from input win', () => {
  const out = resolveConfig({ capabilities: VALID })
  assert.equal(out.capabilities.length, 2)
})

test('resolveConfig: unknown keys are dropped', () => {
  const out = resolveConfig({ unknownKey: 1, headline: 'H' })
  assert.ok(!('unknownKey' in out))
})

test('resolveConfig: non-object input falls back to defaults', () => {
  assert.equal(resolveConfig('nope').headline, DEFAULTS.headline)
})

// ── 2.3 buildLaunch: session-start parameter building ──────────────────────

test('buildLaunch: returns JSON-safe launch shape with workspace', () => {
  const launch = buildLaunch(VALID[0], 'ws-1')
  assert.equal(launch.workspaceId, 'ws-1')
  assert.equal(typeof launch.note, 'string')
  assert.ok(launch.note.includes('Triage'))
})

test('buildLaunch: workspaceId may be null', () => {
  const launch = buildLaunch(VALID[1], null)
  assert.equal(launch.workspaceId, null)
  assert.ok(launch.note.includes('CDI Audit'))
})

test('buildLaunch: result is lossless JSON', () => {
  const launch = buildLaunch(VALID[0], 'ws-2')
  assert.deepEqual(JSON.parse(JSON.stringify(launch)), launch)
})

// ── 2.4 brandTokens: brand palette structure ───────────────────────────────

test('brandTokens: light and dark both return non-empty flat token maps', () => {
  const light = brandTokens('light')
  const dark = brandTokens('dark')
  assert.ok(Object.keys(light).length > 0)
  assert.ok(Object.keys(dark).length > 0)
})

test('brandTokens: light and dark share the same token keys', () => {
  const light = brandTokens('light')
  const dark = brandTokens('dark')
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort())
})

test('brandTokens: light and dark differ in at least one value', () => {
  const light = brandTokens('light')
  const dark = brandTokens('dark')
  const keys = Object.keys(light)
  assert.ok(keys.some((k) => light[k] !== dark[k]))
})

test('brandTokens: every value is a CSS color string', () => {
  const color = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))$/
  for (const scheme of ['light', 'dark']) {
    for (const value of Object.values(brandTokens(scheme))) {
      assert.match(value, color, `scheme=${scheme} value=${value}`)
    }
  }
})

test('brandTokens: unknown scheme falls back to light', () => {
  assert.deepEqual(brandTokens('weird'), brandTokens('light'))
})
