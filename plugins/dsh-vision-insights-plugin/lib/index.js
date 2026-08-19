// dsh-vision-insights-plugin — host entry.
//
// The DSH-side access point for vision insights. Per the agreed architecture
// (docs/PRD-vision-insights.md), the OpenVINO visual app (Intelligent Queue
// Management kit) is a SEPARATE application with its own insight storage
// (SQLite, behind a thin read API); this plugin only ever reads through that
// API via the `baseUrl` config entry — it never contains, calls, or bundles
// the OpenVINO app or its storage directly.
//
// Registers two tools, one per Insight Storage table (docs/PRD-vision-insights.md
// §9 Q1): `query_vision_events` reads per-zone occupancy events (queue-kit),
// `query_checkout_events` reads item add/remove events (self-checkout). Both
// return deterministic facts plus a computed summary; the LLM only narrates
// them (same pattern as dsh-cdi-plugin's cdi_query_rule) — it never sees raw
// video/images, only these events. Routing between the two tools is left to
// normal Cordis/LLM function-calling (tool name + description matching) —
// no dispatch/intake layer in front of them; see §10 for why that pattern
// (used by dsh-triage-plugin's intake-triage skill) doesn't apply here.
//
// The previous `assess_exercise_form` tool (single-frame PT/rehab form check
// coupled directly to an OpenVINO pose endpoint) was retired 2026-08-19 — see
// the package README; its code remains in git history at commit 320bc37.
//
// Design constraints honored here (same as every other plugin in this repo):
//   - No imports from `@deepseek-ai/*` packages: every service is read via
//     `ctx.get(...)`, so the package has zero runtime dependencies.
//   - All registrations return disposers; `apply()` returns a combined
//     disposer so stopping/updating the entry tears everything down.

import { queryVisionEvents } from './query-events.js'
import { queryCheckoutEvents } from './query-checkout-events.js'

/** The bundle entry id; also the prompt-section namespace. */
export const name = 'linkhealth-vision'

/** Hard service dependencies — see the triage plugin for why this matters:
 * without them, `ctx.get(...)` inside `apply()` can race plugin activation
 * and return undefined, silently skipping registration. */
export const inject = ['tools', 'systemPrompt']

/** Entry config defaults (overridable via the patch row's `config`). */
export const config = {
  /**
   * Base URL of the insight data source read API, serving both `/v1/events`
   * and `/v1/checkout-events` off the same host. Required for either tool to
   * work — e.g. `http://10.128.0.11:8090` for the showcase deployment (see
   * infra/vision-insights-store and docs/PRD-vision-insights.md).
   */
  baseUrl: '',
}

/** Render the query_vision_events tool result for the model. */
function renderEvents(args, value) {
  if (value.error) {
    return [{ type: 'text', text: `query_vision_events: FAILED — ${value.error}` }]
  }
  const lines = value.summary.map(
    (z) => `  ${z.zone}: events=${z.events} over_capacity=${z.overCapacityEvents} max_count=${z.maxCount}`,
  )
  return [{ type: 'text', text: `query_vision_events: ${value.events.length} event(s)\n${lines.join('\n')}` }]
}

/** Render the query_checkout_events tool result for the model. */
function renderCheckoutEvents(args, value) {
  if (value.error) {
    return [{ type: 'text', text: `query_checkout_events: FAILED — ${value.error}` }]
  }
  const lines = value.summary.map((i) => `  ${i.item}: ${i.netCount}`)
  return [
    {
      type: 'text',
      text: `query_checkout_events: ${value.events.length} event(s)\nnet basket:\n${lines.join('\n')}`,
    },
  ]
}

export function apply(ctx, entryConfig) {
  const { baseUrl = config.baseUrl } = entryConfig ?? {}
  const disposers = []

  const tools = ctx.get('tools')
  const systemPrompt = ctx.get('systemPrompt')

  if (tools) {
    disposers.push(
      tools.register({
        name: 'query_vision_events',
        description:
          'Query structured zone-occupancy events (people counted per zone, capacity, over-capacity flag) from the ' +
          'vision-insights data source. Use this to answer questions like "what happened in the last hour" or ' +
          '"did any zone exceed capacity". Returns raw events plus a deterministic per-zone summary — the summary ' +
          'is authoritative; do not recompute or second-guess it.',
        parameters: {
          type: 'object',
          properties: {
            since: { type: 'string', description: 'ISO-8601 timestamp — only events at or after this time.' },
            zone: { type: 'string', description: 'Filter to one zone id (e.g. "zone0"). Omit for all zones.' },
            limit: { type: 'integer', description: 'Max events to return (default 100, max 1000).' },
          },
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              events: { type: 'array' },
              summary: { type: 'array' },
              error: { type: 'string' },
            },
          },
          render: renderEvents,
        },
        async execute(args) {
          try {
            return await queryVisionEvents({ baseUrl, ...args })
          } catch (error) {
            return { events: [], summary: [], error: String(error?.message ?? error) }
          }
        },
      }),
    )
    disposers.push(
      tools.register({
        name: 'query_checkout_events',
        description:
          'Query structured item add/remove events (retail products entering or leaving a shopping basket) from ' +
          'the vision-insights data source. Use this to answer questions like "what\'s currently in the basket" or ' +
          '"how many bananas were added". Returns raw events plus a deterministic net-basket summary (add minus ' +
          'remove per item, items already fully removed omitted) — the summary is authoritative; do not recompute ' +
          'or second-guess it.',
        parameters: {
          type: 'object',
          properties: {
            since: { type: 'string', description: 'ISO-8601 timestamp — only events at or after this time.' },
            action: { type: 'string', enum: ['add', 'remove'], description: 'Filter to one action. Omit for both.' },
            limit: { type: 'integer', description: 'Max events to return (default 100, max 1000).' },
          },
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              events: { type: 'array' },
              summary: { type: 'array' },
              error: { type: 'string' },
            },
          },
          render: renderCheckoutEvents,
        },
        async execute(args) {
          try {
            return await queryCheckoutEvents({ baseUrl, ...args })
          } catch (error) {
            return { events: [], summary: [], error: String(error?.message ?? error) }
          }
        },
      }),
    )
  } else {
    ctx.logger?.warn('[linkhealth-vision] tools service unavailable — query_vision_events/query_checkout_events not registered')
  }

  if (systemPrompt) {
    disposers.push(
      systemPrompt.section({
        name: 'linkhealth-vision',
        order: 250,
        text:
          'LinkHealth Vision Insights: call `query_vision_events` for zone occupancy/capacity questions, or ' +
          '`query_checkout_events` for shopping-basket add/remove questions (both are simulations over sample ' +
          "video, not live cameras). Each returns deterministic facts only — narrate them, never override a tool's " +
          'summary. You cannot see images or video directly.',
      }),
    )
  } else {
    ctx.logger?.warn('[linkhealth-vision] systemPrompt service unavailable — prompt section not registered')
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // teardown is best-effort
      }
    }
  }
}
