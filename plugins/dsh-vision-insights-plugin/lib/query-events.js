// Pure, independently-testable core for the query_vision_events tool.
//
// Talks to the Phase 2 read API (docs/PRD-vision-insights.md §6) — a thin
// FastAPI service backed by SQLite, running on the OpenVINO VM. This module
// owns the HTTP call and the deterministic per-zone summary; lib/index.js
// only wires it into a Cordis tool descriptor. `fetchImpl` is injectable so
// tests never make a real network call (mirrors dsh-triage-plugin's
// lib/validate.js split: pure logic separate from the plugin entry).

/** Build the /v1/events request URL from tool arguments. */
export function buildEventsUrl(baseUrl, { since, zone, limit } = {}) {
  const url = new URL('/v1/events', baseUrl)
  if (since) url.searchParams.set('since', since)
  if (zone) url.searchParams.set('zone', zone)
  if (limit) url.searchParams.set('limit', String(limit))
  return url.toString()
}

/**
 * Deterministic per-zone rollup — the same aggregation
 * infra/openvino-queue-kit/run_demo.sh prints, computed here so the LLM
 * narrates a fixed summary instead of eyeballing a raw event list.
 */
export function summarizeEvents(events) {
  const zones = new Map()
  for (const e of events) {
    if (!zones.has(e.zone)) zones.set(e.zone, { zone: e.zone, events: 0, overCapacityEvents: 0, maxCount: 0 })
    const z = zones.get(e.zone)
    z.events += 1
    if (e.over_capacity) z.overCapacityEvents += 1
    z.maxCount = Math.max(z.maxCount, e.count)
  }
  return [...zones.values()].sort((a, b) => a.zone.localeCompare(b.zone))
}

/**
 * Fetch events from the read API and return { events, summary }.
 * Throws on network/HTTP failure — the caller (the tool's execute) turns
 * that into a tool-error result rather than a thrown exception reaching the
 * model, per this repo's convention of never letting a listener/tool crash
 * the pipeline.
 */
export async function queryVisionEvents({ baseUrl, since, zone, limit, fetchImpl = fetch } = {}) {
  if (!baseUrl) {
    throw new Error('baseUrl not configured — the vision-insights read API is not wired up yet')
  }
  const url = buildEventsUrl(baseUrl, { since, zone, limit })
  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(`vision-insights read API returned HTTP ${response.status}`)
  }
  const body = await response.json()
  const events = Array.isArray(body.events) ? body.events : []
  return { events, summary: summarizeEvents(events) }
}
