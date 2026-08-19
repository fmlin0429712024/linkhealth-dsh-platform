// Contract test for dsh-vision-insights-plugin's host entry.
// Zero dependencies: node:test + node:assert. Run: node --test
//
// Pins the Cordis entry-module shape (name/inject/config/apply), the
// apply() wiring contract, and both tool registrations
// (query_vision_events, query_checkout_events). query-events.test.mjs and
// query-checkout-events.test.mjs cover each tool's pure logic in depth (URL
// building, summary math, HTTP-mocked fetch) — this file only checks that
// apply() wires both up correctly against the tools/systemPrompt services.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { name, inject, config, apply } from '../lib/index.js'

function makeCtx({ systemPrompt = true, tools = true } = {}) {
  const registered = { sections: [], toolDescriptors: [], disposed: [] }
  const services = {
    systemPrompt: {
      section: (section) => {
        registered.sections.push(section)
        return () => registered.disposed.push(`section:${section.name}`)
      },
    },
    tools: {
      register: (descriptor) => {
        registered.toolDescriptors.push(descriptor)
        return () => registered.disposed.push(`tool:${descriptor.name}`)
      },
    },
  }
  return {
    ctx: {
      get: (svc) => {
        if (systemPrompt && svc === 'systemPrompt') return services.systemPrompt
        if (tools && svc === 'tools') return services.tools
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

test('config: baseUrl unset by default (must be configured per deployment)', () => {
  assert.equal(config.baseUrl, '')
})

test('apply() with no services does not throw and returns a disposer', () => {
  const { ctx } = makeCtx({ systemPrompt: false, tools: false })
  const dispose = apply(ctx, {})
  assert.equal(typeof dispose, 'function')
  assert.doesNotThrow(() => dispose())
})

test('apply() registers the prompt section and both tools; dispose tears all three down', () => {
  const { ctx, registered } = makeCtx()
  const dispose = apply(ctx, { baseUrl: 'http://backend.test:8080' })

  assert.equal(registered.sections.length, 1)
  assert.equal(registered.sections[0].name, 'linkhealth-vision')

  assert.equal(registered.toolDescriptors.length, 2)
  assert.equal(registered.toolDescriptors[0].name, 'query_vision_events')
  assert.equal(typeof registered.toolDescriptors[0].execute, 'function')
  assert.equal(registered.toolDescriptors[1].name, 'query_checkout_events')
  assert.equal(typeof registered.toolDescriptors[1].execute, 'function')

  dispose()
  assert.equal(registered.disposed.length, 3)
})

test('query_vision_events execute() surfaces a fetch failure as a tool-error result, not a throw', async () => {
  const { ctx, registered } = makeCtx()
  apply(ctx, { baseUrl: 'http://backend.test:8080' })
  const tool = registered.toolDescriptors.find((t) => t.name === 'query_vision_events')

  const result = await tool.execute({})
  // no fetchImpl override reaches the real global fetch, which will fail
  // against backend.test — execute() must catch that, not throw.
  assert.equal(result.events.length, 0)
  assert.ok(result.error)
})

test('query_checkout_events execute() surfaces a fetch failure as a tool-error result, not a throw', async () => {
  const { ctx, registered } = makeCtx()
  apply(ctx, { baseUrl: 'http://backend.test:8080' })
  const tool = registered.toolDescriptors.find((t) => t.name === 'query_checkout_events')

  const result = await tool.execute({})
  assert.equal(result.events.length, 0)
  assert.ok(result.error)
})

test('query_vision_events result renders a FAILED line when execute() returns an error', () => {
  const { ctx, registered } = makeCtx()
  apply(ctx, { baseUrl: 'http://backend.test:8080' })
  const tool = registered.toolDescriptors.find((t) => t.name === 'query_vision_events')

  const rendered = tool.output.render({}, { events: [], summary: [], error: 'boom' })
  assert.match(rendered[0].text, /FAILED — boom/)
})

test('query_checkout_events result renders a FAILED line when execute() returns an error', () => {
  const { ctx, registered } = makeCtx()
  apply(ctx, { baseUrl: 'http://backend.test:8080' })
  const tool = registered.toolDescriptors.find((t) => t.name === 'query_checkout_events')

  const rendered = tool.output.render({}, { events: [], summary: [], error: 'boom' })
  assert.match(rendered[0].text, /FAILED — boom/)
})
