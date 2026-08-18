// Contract test for dsh-vision-insights-plugin's host entry (scaffold).
// Zero dependencies: node:test + node:assert. Run: node --test
//
// Pins the Cordis entry-module shape (name/inject/config/apply) and the
// apply() wiring contract. The plugin currently registers no tools (the
// query_vision_events tool lands with the Phase 2 integration — see
// docs/PRD-vision-insights.md).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { name, inject, config, apply } from '../lib/index.js'

function makeCtx({ systemPrompt = true } = {}) {
  const registered = { sections: [], disposed: [] }
  const services = {
    systemPrompt: {
      section: (section) => {
        registered.sections.push(section)
        return () => registered.disposed.push(`section:${section.name}`)
      },
    },
  }
  return {
    ctx: {
      get: (svc) => {
        if (systemPrompt && svc === 'systemPrompt') return services.systemPrompt
        return undefined
      },
      logger: { warn() {}, info() {} },
    },
    registered,
  }
}

test('exports the Cordis entry contract', () => {
  assert.equal(typeof name, 'string')
  assert.ok(name.length > 0)
  assert.ok(Array.isArray(inject))
  assert.ok(inject.includes('tools'))
  assert.ok(inject.includes('systemPrompt'))
  assert.equal(typeof apply, 'function')
})

test('config: baseUrl unset by default (data source integration is Phase 2)', () => {
  assert.equal(config.baseUrl, '')
})

test('apply() with no services does not throw and returns a disposer', () => {
  const { ctx } = makeCtx({ systemPrompt: false })
  const dispose = apply(ctx, {})
  assert.equal(typeof dispose, 'function')
  assert.doesNotThrow(() => dispose())
})

test('apply() registers exactly one prompt section; dispose tears it down', () => {
  const { ctx, registered } = makeCtx()
  const dispose = apply(ctx, { baseUrl: 'http://backend.test:8080' })

  assert.equal(registered.sections.length, 1)
  assert.equal(registered.sections[0].name, 'linkhealth-vision')

  dispose()
  assert.equal(registered.disposed.length, 1)
})
