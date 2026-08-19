// Pure, independently-testable core for the query_checkout_events tool.
//
// Talks to the same read API's second endpoint, `GET /v1/checkout-events`
// (docs/PRD-vision-insights.md §9/§10) — item add/remove events from the
// automated_self_checkout kit, stored in a separate `checkout_events` table
// (see infra/vision-insights-store/README.md "Why two tables instead of
// one"). Mirrors lib/query-events.js's split: this module owns the HTTP call
// and the deterministic summary; lib/index.js only wires it into a Cordis
// tool descriptor. `fetchImpl` is injectable so tests never make a real
// network call.

/** Build the /v1/checkout-events request URL from tool arguments. */
export function buildCheckoutEventsUrl(baseUrl, { since, action, limit } = {}) {
  const url = new URL('/v1/checkout-events', baseUrl)
  if (since) url.searchParams.set('since', since)
  if (action) url.searchParams.set('action', action)
  if (limit) url.searchParams.set('limit', String(limit))
  return url.toString()
}

/**
 * Strip the kit's "#<tracker id> " prefix off `class` to get the item name.
 * The tracker id is usually numeric but can be the literal string "None"
 * (the kit's own marker for an untracked detection) — match any non-space
 * token, not just digits, or "#None apple" fails to merge with "apple".
 */
function itemName(eventClass) {
  return String(eventClass).replace(/^#\S+\s+/, '')
}

/**
 * Deterministic net-basket rollup: add minus remove per item, by item name
 * (tracker id stripped — the kit assigns a new id per tracked instance, so
 * grouping by raw `class` would never merge an add with its own remove).
 * Items that net to zero (added then fully removed) are dropped — they're
 * not currently in the basket, which is what this summary answers.
 */
export function summarizeCheckoutEvents(events) {
  const net = new Map()
  for (const e of events) {
    const item = itemName(e.class)
    const delta = e.action === 'remove' ? -1 : e.action === 'add' ? 1 : 0
    net.set(item, (net.get(item) ?? 0) + delta)
  }
  return [...net.entries()]
    .filter(([, netCount]) => netCount !== 0)
    .map(([item, netCount]) => ({ item, netCount }))
    .sort((a, b) => a.item.localeCompare(b.item))
}

/**
 * Fetch checkout events from the read API and return { events, summary }.
 * Throws on network/HTTP failure — the caller (the tool's execute) turns
 * that into a tool-error result rather than a thrown exception reaching the
 * model, per this repo's convention.
 */
export async function queryCheckoutEvents({ baseUrl, since, action, limit, fetchImpl = fetch } = {}) {
  if (!baseUrl) {
    throw new Error('baseUrl not configured — the vision-insights read API is not wired up yet')
  }
  const url = buildCheckoutEventsUrl(baseUrl, { since, action, limit })
  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(`vision-insights read API returned HTTP ${response.status}`)
  }
  const body = await response.json()
  const events = Array.isArray(body.events) ? body.events : []
  return { events, summary: summarizeCheckoutEvents(events) }
}
