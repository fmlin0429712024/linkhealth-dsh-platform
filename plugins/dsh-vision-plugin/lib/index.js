// dsh-vision-plugin — PLACEHOLDER host entry.
//
// Loaded by the Cordis loader as one bundle entry (`name: 'dsh-vision-plugin'`
// in cordis.patch.yml, bundle-instance id `linkhealth-vision`). Today this
// only registers a system-prompt section announcing the plugin is scaffolded
// but not yet implemented, so the package loads cleanly in a DSH profile
// while the real business logic is built out. See README.md "Status".
//
// Planned (not yet implemented — see README.md "Planned shape"):
//   - a nursing/care-observation System Prompt
//   - care-scenario tools (assess_fall_risk, check_dressing, ...) that call
//     out to a vision-capable model via a `baseUrl` config entry (this
//     plugin never bundles or deploys that model itself — see
//     infra/openvino-vision/ for the separately-managed inference service)
//   - a structured care-report output schema
//
// Design constraints honored here (same as every other plugin in this repo):
//   - No imports from `@deepseek-ai/*` packages: every service is read via
//     `ctx.get(...)`, so the package has zero runtime dependencies.
//   - All registrations return disposers; `apply()` returns a combined
//     disposer so stopping/updating the entry tears everything down.

/** The bundle entry id; also the prompt-section namespace. */
export const name = 'linkhealth-vision'

/** Hard service dependency — see the triage plugin for why this matters:
 * without it, `ctx.get('systemPrompt')` inside `apply()` can race plugin
 * activation and return undefined, silently skipping registration. */
export const inject = ['systemPrompt']

/** Entry config defaults (overridable via the patch row's `config`). */
export const config = {
  /** Base URL of the vision-capable model backend (set once Phase 1 lands). */
  baseUrl: '',
}

export function apply(ctx, entryConfig) {
  const { baseUrl = config.baseUrl } = entryConfig ?? {}
  const disposers = []

  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt) {
    disposers.push(
      systemPrompt.section({
        name: 'linkhealth-vision',
        order: 250,
        text:
          'LinkHealth Vision is scaffolded but not yet implemented — no care-observation tools are registered yet. Do not claim to assess patient images.',
      }),
    )
  } else {
    ctx.logger?.warn('[linkhealth-vision] systemPrompt service unavailable — placeholder section not registered')
  }

  if (!baseUrl) {
    ctx.logger?.info('[linkhealth-vision] placeholder plugin loaded — no baseUrl configured yet, no vision tools registered')
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
