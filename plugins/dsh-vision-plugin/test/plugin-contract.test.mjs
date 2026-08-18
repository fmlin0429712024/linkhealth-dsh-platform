// Contract test for dsh-vision-plugin's host entry.
// Zero dependencies: node:test + node:assert. Run: node --test
//
// Pins the Cordis entry-module shape (name/inject/config/apply) and the
// apply() wiring contract: one tool registration + one prompt section, both
// returning disposers. Business logic lives in pose.test.mjs and
// assess-exercise-form.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { name, inject, config, apply } from '../lib/index.js'

function makeCtx({ tools = true, systemPrompt = true } = {}) {
  const registered = { tools: [], sections: [], disposed: [] }
  const services = {
    tools: {
      register: (definition) => {
        registered.tools.push(definition)
        return () => registered.disposed.push(`tool:${definition.name}`)
      },
    },
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
        if (tools && svc === 'tools') return services.tools
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

test('config defaults: baseUrl unset, confidenceThreshold 0.1', () => {
  assert.equal(config.baseUrl, '')
  assert.equal(config.confidenceThreshold, 0.1)
})

test('apply() with no services does not throw and returns a disposer', () => {
  const { ctx } = makeCtx({ tools: false, systemPrompt: false })
  const dispose = apply(ctx, {})
  assert.equal(typeof dispose, 'function')
  assert.doesNotThrow(() => dispose())
})

test('apply() registers exactly one tool and one prompt section; dispose tears both down', () => {
  const { ctx, registered } = makeCtx()
  const dispose = apply(ctx, { baseUrl: 'http://backend.test:8080' })

  assert.equal(registered.tools.length, 1)
  assert.equal(registered.tools[0].name, 'assess_exercise_form')
  assert.equal(registered.tools[0].parameters.required[0], 'image_path')
  assert.equal(registered.tools[0].output.schema.type, 'object')
  assert.equal(typeof registered.tools[0].execute, 'function')

  assert.equal(registered.sections.length, 1)
  assert.equal(registered.sections[0].name, 'linkhealth-vision')

  dispose()
  assert.equal(registered.disposed.length, 2)
})

test('the tool registers even without a baseUrl (configuration error surfaces at call time)', () => {
  const { ctx, registered } = makeCtx()
  const dispose = apply(ctx, {})
  assert.equal(registered.tools.length, 1)
  dispose()
})
