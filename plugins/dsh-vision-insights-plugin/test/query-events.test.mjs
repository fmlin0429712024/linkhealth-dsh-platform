// Unit tests for query_vision_events' pure core. Zero dependencies:
// node:test + node:assert. No network — fetchImpl is always a mock here.
// Run: node --test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEventsUrl, summarizeEvents, queryVisionEvents } from '../lib/query-events.js'

// ── buildEventsUrl ───────────────────────────────────────────────────────

test('buildEventsUrl: no params, just the path', () => {
  assert.equal(buildEventsUrl('http://10.128.0.11:8090'), 'http://10.128.0.11:8090/v1/events')
})

test('buildEventsUrl: since/zone/limit become query params', () => {
  const url = buildEventsUrl('http://10.128.0.11:8090', { since: '2026-08-19T00:00:00Z', zone: 'zone0', limit: 10 })
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get('since'), '2026-08-19T00:00:00Z')
  assert.equal(parsed.searchParams.get('zone'), 'zone0')
  assert.equal(parsed.searchParams.get('limit'), '10')
})

// ── summarizeEvents ──────────────────────────────────────────────────────

const SAMPLE_EVENTS = [
  { zone: 'zone0', count: 4, over_capacity: true },
  { zone: 'zone0', count: 2, over_capacity: false },
  { zone: 'zone1', count: 1, over_capacity: false },
]

test('summarizeEvents: per-zone rollup, sorted by zone id', () => {
  const summary = summarizeEvents(SAMPLE_EVENTS)
  assert.deepEqual(summary, [
    { zone: 'zone0', events: 2, overCapacityEvents: 1, maxCount: 4 },
    { zone: 'zone1', events: 1, overCapacityEvents: 0, maxCount: 1 },
  ])
})

test('summarizeEvents: empty input is an empty summary', () => {
  assert.deepEqual(summarizeEvents([]), [])
})

// ── queryVisionEvents ────────────────────────────────────────────────────

function mockFetch(body, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, json: async () => body })
}

test('queryVisionEvents: throws without a configured baseUrl', async () => {
  await assert.rejects(() => queryVisionEvents({}), /baseUrl not configured/)
})

test('queryVisionEvents: returns events + computed summary', async () => {
  const result = await queryVisionEvents({
    baseUrl: 'http://10.128.0.11:8090',
    fetchImpl: mockFetch({ events: SAMPLE_EVENTS, count: 3 }),
  })
  assert.equal(result.events.length, 3)
  assert.equal(result.summary.length, 2)
  assert.equal(result.summary[0].overCapacityEvents, 1)
})

test('queryVisionEvents: non-array events field degrades to empty list, not a crash', async () => {
  const result = await queryVisionEvents({
    baseUrl: 'http://10.128.0.11:8090',
    fetchImpl: mockFetch({ events: null }),
  })
  assert.deepEqual(result.events, [])
  assert.deepEqual(result.summary, [])
})

test('queryVisionEvents: throws on non-OK HTTP response', async () => {
  await assert.rejects(
    () => queryVisionEvents({ baseUrl: 'http://10.128.0.11:8090', fetchImpl: mockFetch({}, { ok: false, status: 503 }) }),
    /HTTP 503/,
  )
})
