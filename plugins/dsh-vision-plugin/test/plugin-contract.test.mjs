// Contract test for dsh-vision-plugin's PLACEHOLDER host entry.
// Zero dependencies: node:test + node:assert. Run: node --test
//
// This does not test business logic (there isn't any yet — see README.md
// "Status"). It only pins the Cordis entry-module shape so the plugin keeps
// loading cleanly while the real tools/prompt are built out.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { name, inject, config, apply } from '../lib/index.js'

test('exports the Cordis entry contract', () => {
  assert.equal(typeof name, 'string')
  assert.ok(name.length > 0)
  assert.ok(Array.isArray(inject))
  assert.equal(typeof apply, 'function')
})

test('config has a baseUrl placeholder, unset by default', () => {
  assert.equal(config.baseUrl, '')
})

test('apply() with no systemPrompt service does not throw, returns a disposer', () => {
  const ctx = { get: () => undefined, logger: { warn() {}, info() {} } }
  const dispose = apply(ctx, {})
  assert.equal(typeof dispose, 'function')
  assert.doesNotThrow(() => dispose())
})

test('apply() registers exactly one systemPrompt section when the service is present', () => {
  const registered = []
  const ctx = {
    get: (svc) => (svc === 'systemPrompt' ? { section: (s) => (registered.push(s), () => {}) } : undefined),
    logger: { warn() {}, info() {} },
  }
  const dispose = apply(ctx, {})
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'linkhealth-vision')
  dispose()
})
