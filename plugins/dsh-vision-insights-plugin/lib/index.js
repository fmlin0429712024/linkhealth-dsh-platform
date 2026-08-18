// dsh-vision-insights-plugin — host entry (scaffold).
//
// The DSH-side access point for vision insights. Per the agreed architecture
// (docs/PRD-vision-insights.md), the OpenVINO visual app is a SEPARATE
// application with its own insight storage; DSH accesses that data source only
// through a read API, and only once the integration effort (Phase 2) lands.
//
// Today this entry registers NO tools: the plugin is a placeholder so the
// package loads cleanly in a DSH profile while the OpenVINO app + data source
// are built out. The planned tool is `query_vision_events`-style — read
// structured insight events via the `baseUrl` config entry, deterministic tool
// decides, LLM only narrates (same pattern as dsh-cdi-plugin's cdi_query_rule).
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

/** The bundle entry id; also the prompt-section namespace. */
export const name = 'linkhealth-vision'

/** Hard service dependencies — see the triage plugin for why this matters:
 * without them, `ctx.get(...)` inside `apply()` can race plugin activation
 * and return undefined, silently skipping registration. */
export const inject = ['tools', 'systemPrompt']

/** Entry config defaults (overridable via the patch row's `config`). */
export const config = {
  /**
   * Base URL of the insight data source read API (`/v1/events`).
   * Used by the future query tool; unset until Phase 2 integration lands.
   */
  baseUrl: '',
}

export function apply(ctx, entryConfig) {
  const disposers = []
  const systemPrompt = ctx.get('systemPrompt')

  // Scaffold note only — no tools yet. Keeps the model honest about the
  // current lack of vision-insight capabilities until the data source exists.
  if (systemPrompt) {
    disposers.push(
      systemPrompt.section({
        name: 'linkhealth-vision',
        order: 250,
        text:
          'LinkHealth Vision Insights is not yet integrated: no vision-insight tools are registered. ' +
          'The OpenVINO visual app and its insight storage are a separate application, not reachable from here. ' +
          'Do not claim to analyze images or query vision events.',
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
