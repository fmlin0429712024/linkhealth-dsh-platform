// Unit tests for query_checkout_events' pure core. Zero dependencies:
// node:test + node:assert. No network — fetchImpl is always a mock here.
// Run: node --test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCheckoutEventsUrl, summarizeCheckoutEvents, queryCheckoutEvents } from '../lib/query-checkout-events.js'

// ── buildCheckoutEventsUrl ───────────────────────────────────────────────

test('buildCheckoutEventsUrl: no params, just the path', () => {
  assert.equal(buildCheckoutEventsUrl('http://10.128.0.11:8090'), 'http://10.128.0.11:8090/v1/checkout-events')
})

test('buildCheckoutEventsUrl: since/action/limit become query params', () => {
  const url = buildCheckoutEventsUrl('http://10.128.0.11:8090', {
    since: '2026-08-19T00:00:00Z',
    action: 'add',
    limit: 10,
  })
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get('since'), '2026-08-19T00:00:00Z')
  assert.equal(parsed.searchParams.get('action'), 'add')
  assert.equal(parsed.searchParams.get('limit'), '10')
})

// ── summarizeCheckoutEvents ──────────────────────────────────────────────

// Real shape from infra/openvino-self-checkout's headless_driver.py output —
// `class` carries a "#<tracker id> " prefix per tracked instance.
const SAMPLE_EVENTS = [
  { ts: '2026-08-19T00:09:11', class: '#8 banana', action: 'add', message: '1 #8 banana added', source: 'self-checkout-kit-sim' },
  { ts: '2026-08-19T00:09:12', class: '#9 banana', action: 'add', message: '1 #9 banana added', source: 'self-checkout-kit-sim' },
  { ts: '2026-08-19T00:09:13', class: '#1 banana', action: 'remove', message: '1 #1 banana removed', source: 'self-checkout-kit-sim' },
  { ts: '2026-08-19T00:09:14', class: '#3 bottle', action: 'add', message: '1 #3 bottle added', source: 'self-checkout-kit-sim' },
  { ts: '2026-08-19T00:09:15', class: '#3 bottle', action: 'remove', message: '1 #3 bottle removed', source: 'self-checkout-kit-sim' },
]

test('summarizeCheckoutEvents: net add-minus-remove per item, tracker id prefix stripped', () => {
  const summary = summarizeCheckoutEvents(SAMPLE_EVENTS)
  // banana: two adds (#8, #9) + one remove (#1, a different tracked instance) = net 1
  // bottle: one add + one remove of the same tracker id = net 0 → dropped
  assert.deepEqual(summary, [{ item: 'banana', netCount: 1 }])
})

test('summarizeCheckoutEvents: items fully removed (net 0) are omitted', () => {
  const summary = summarizeCheckoutEvents([
    { class: '#1 apple', action: 'add' },
    { class: '#1 apple', action: 'remove' },
  ])
  assert.deepEqual(summary, [])
})

test('summarizeCheckoutEvents: results sorted by item name', () => {
  const summary = summarizeCheckoutEvents([
    { class: '#1 banana', action: 'add' },
    { class: '#2 apple', action: 'add' },
  ])
  assert.deepEqual(summary, [
    { item: 'apple', netCount: 1 },
    { item: 'banana', netCount: 1 },
  ])
})

test('summarizeCheckoutEvents: empty input is an empty summary', () => {
  assert.deepEqual(summarizeCheckoutEvents([]), [])
})

test('summarizeCheckoutEvents: "#None" tracker id (untracked-detection marker, seen in real kit output) merges with the same item\'s numeric-tracker events', () => {
  const summary = summarizeCheckoutEvents([
    { class: '#8 apple', action: 'add' },
    { class: '#None apple', action: 'add' },
  ])
  assert.deepEqual(summary, [{ item: 'apple', netCount: 2 }])
})

// ── queryCheckoutEvents ───────────────────────────────────────────────────

function mockFetch(body, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, json: async () => body })
}

test('queryCheckoutEvents: throws without a configured baseUrl', async () => {
  await assert.rejects(() => queryCheckoutEvents({}), /baseUrl not configured/)
})

test('queryCheckoutEvents: returns events + computed summary', async () => {
  const result = await queryCheckoutEvents({
    baseUrl: 'http://10.128.0.11:8090',
    fetchImpl: mockFetch({ events: SAMPLE_EVENTS, count: 5 }),
  })
  assert.equal(result.events.length, 5)
  assert.deepEqual(result.summary, [{ item: 'banana', netCount: 1 }])
})

test('queryCheckoutEvents: non-array events field degrades to empty list, not a crash', async () => {
  const result = await queryCheckoutEvents({
    baseUrl: 'http://10.128.0.11:8090',
    fetchImpl: mockFetch({ events: null }),
  })
  assert.deepEqual(result.events, [])
  assert.deepEqual(result.summary, [])
})

test('queryCheckoutEvents: throws on non-OK HTTP response', async () => {
  await assert.rejects(
    () =>
      queryCheckoutEvents({
        baseUrl: 'http://10.128.0.11:8090',
        fetchImpl: mockFetch({}, { ok: false, status: 503 }),
      }),
    /HTTP 503/,
  )
})
