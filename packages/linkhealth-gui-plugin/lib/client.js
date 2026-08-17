// linkhealth-gui-plugin — browser half (client bundle).
//
// Registered by the web surface because package.json declares
// `dsh.client.platform: "web"`; served as /plugins/linkhealth-gui/client.js
// and executed as a `window.__ModuleLoader__.load({ id, factory })` module.
//
// What it does (PRD-gui-plugin.md §6):
//   FR1 brand theme  — theme.overrideTokens with { light, dark } pairs
//   FR3 launcher     — additive `sidebar.footer.action` entries per capability
//   FR4 showcase     — additive `settings.section` capability cards
// (FR2 hero copy was dropped: DSH locale dictionaries cannot be overridden
// cross-package — registering the same namespace+locale key throws — so the
// branded welcome is carried by the launcher/cards instead of the hero.)
//
// The data logic (config parsing, launch building, brand palettes) is INLINED
// here because DSH client bundles are self-contained: require() reaches only
// platform modules, never package-internal files. `lib/launcher-config.js` is
// the same logic as a standalone ESM module, unit-tested by
// test/launcher-config.test.mjs — keep the two in sync; those tests are the
// contract this inline copy must satisfy.
//
// All registrations are additive (no default component replaced), disposers
// are returned from apply(), and unload restores the stock UI.

window.__ModuleLoader__.load({
  id: 'linkhealth-gui-plugin',
  factory: (require) => {
    const React = require('react')

    // ── inlined launcher-config (see contract note above) ──────────────────
    // NOTE (learned live): the DSH client graph passes only id/url/inject to
    // the browser — a patch entry's `config` does NOT reach the client plugin.
    // Official client plugins read state via RPC/settings instead. So the
    // front-door configuration lives HERE as built-in defaults (single place
    // to edit); if a config channel ever arrives, resolveConfig merges it over
    // these.
    const BUILTIN_CONFIG = {
      headline: 'LinkHealth Agents',
      placeholder: 'Triage an enquiry, audit documentation — or describe what you need',
      capabilities: [
        {
          id: 'triage',
          label: 'Triage',
          description: 'Classify, score, and route inbound business enquiries.',
        },
        // When dsh-cdi-plugin is integrated, append its entry here (and to the
        // profile patch) — no other change needed.
        // {
        //   id: 'cdi',
        //   label: 'CDI Audit',
        //   description: 'Governed clinical-documentation audit against SOP rules.',
        // },
      ],
    }
    const DEFAULTS = {
      headline: 'LinkHealth Agents',
      placeholder: 'Triage an enquiry, audit documentation — or describe what you need',
      capabilities: [],
    }
    const BRAND_LIGHT = {
      '--dsw-alias-brand-primary': '#0E7C7B',
      '--dsw-alias-state-success-primary': '#1F6E6B',
      '--dsw-alias-bg-base': '#F7FAF9',
      '--dsw-alias-bg-overlay': '#FFFFFF',
    }
    const BRAND_DARK = {
      '--dsw-alias-brand-primary': '#35B3A8',
      '--dsw-alias-state-success-primary': '#4CC3B8',
      '--dsw-alias-bg-base': '#0F1A1A',
      '--dsw-alias-bg-overlay': '#152220',
    }
    function parseCapabilities(input) {
      if (!Array.isArray(input)) throw new Error('capabilities must be an array')
      return input.map((entry) => {
        if (entry === null || typeof entry !== 'object') throw new Error('capability entry must be an object')
        if (typeof entry.id !== 'string' || entry.id.length === 0) throw new Error('capability entry requires a string id')
        if (typeof entry.label !== 'string' || entry.label.length === 0) throw new Error(`capability ${entry.id} requires a string label`)
        if (typeof entry.description !== 'string') throw new Error(`capability ${entry.id} requires a string description`)
        return { ...entry }
      })
    }
    function resolveConfig(partial) {
      const source = partial !== null && typeof partial === 'object' && !Array.isArray(partial) ? partial : {}
      const out = { ...DEFAULTS }
      if (typeof source.headline === 'string') out.headline = source.headline
      if (typeof source.placeholder === 'string') out.placeholder = source.placeholder
      if (source.capabilities !== undefined) out.capabilities = parseCapabilities(source.capabilities)
      return out
    }
    function buildLaunch(capability, workspaceId) {
      return { workspaceId: workspaceId ?? null, note: `Start ${capability.label} — ${capability.description}` }
    }
    function brandTokens(scheme) {
      return scheme === 'dark' ? { ...BRAND_DARK } : { ...BRAND_LIGHT }
    }

    // ── plugin contract ─────────────────────────────────────────────────────
    const inject = ['slots', 'theme', 'workspaces']

    function apply(ctx, config) {
      const cfg = resolveConfig({ ...BUILTIN_CONFIG, ...(config ?? {}) })
      const disposers = []
      const slots = ctx.get('slots')
      const theme = ctx.get('theme')
      const workspaces = ctx.get('workspaces')

      // FR1 — brand theme: one override layer carrying both color schemes.
      if (theme) {
        const pairs = {}
        const light = brandTokens('light')
        const dark = brandTokens('dark')
        for (const key of Object.keys(light)) pairs[key] = { light: light[key], dark: dark[key] }
        disposers.push(theme.overrideTokens('linkhealth-gui', pairs))
      }

      if (slots) {
        // FR3 — capability launcher in the sidebar footer (additive list slot).
        const onLaunch = (capability) => {
          const launch = buildLaunch(capability, undefined)
          if (workspaces) workspaces.startSession(launch.workspaceId ?? undefined)
          console.log(`[linkhealth-gui] ${launch.note}`)
        }
        disposers.push(
          slots.inject('sidebar.footer.action', () =>
            slots.register(
              {
                name: 'sidebar.footer.action',
                id: 'linkhealth-launcher',
                order: -100,
                inject: () => ({ capabilities: cfg.capabilities, onLaunch }),
              },
              Launcher,
            ),
          ),
        )

        // FR4 — capability showcase in Settings (additive section slot).
        disposers.push(
          slots.inject('settings.section', () =>
            slots.register(
              {
                name: 'settings.section',
                id: 'linkhealth-capabilities',
                order: 900,
                label: () => 'LinkHealth Capabilities',
                inject: () => ({ capabilities: cfg.capabilities, headline: cfg.headline }),
              },
              CapabilityShowcase,
            ),
          ),
        )
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

    // ── components (inline styles reference the brand CSS variables, so the
    // theme override colors them automatically in light and dark) ───────────

    function Launcher({ capabilities, onLaunch, wide }) {
      if (!capabilities || capabilities.length === 0) return null
      return React.createElement(
        'div',
        { style: { display: 'flex', gap: 4, padding: '0 8px 8px', flexWrap: 'wrap' } },
        capabilities.map((cap) =>
          React.createElement(
            'button',
            {
              key: cap.id,
              type: 'button',
              onClick: () => onLaunch(cap),
              title: cap.description,
              style: {
                flex: '1 1 auto',
                minWidth: 0,
                cursor: 'pointer',
                border: '1px solid var(--dsw-alias-state-success-primary)',
                borderRadius: 999,
                background: 'transparent',
                color: 'var(--dsw-alias-brand-primary)',
                fontSize: wide ? 12 : 11,
                lineHeight: '22px',
                padding: '0 10px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            },
            cap.label,
          ),
        ),
      )
    }

    function CapabilityShowcase(props) {
      const { capabilities, headline } = props
      if (!capabilities || capabilities.length === 0) return null
      return React.createElement(
        'section',
        { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        React.createElement('h2', { style: { margin: 0 } }, headline),
        capabilities.map((cap) =>
          React.createElement(
            'article',
            {
              key: cap.id,
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '12px 14px',
                border: '1px solid var(--dsw-alias-border-l2, #e3e6ea)',
                borderRadius: 12,
                background: 'var(--dsw-alias-bg-overlay)',
              },
            },
            React.createElement('h3', { style: { margin: 0, fontSize: 15 } }, cap.label),
            React.createElement('p', { style: { margin: 0, fontSize: 13, opacity: 0.75 } }, cap.description),
            React.createElement(
              'span',
              { style: { alignSelf: 'flex-start', fontSize: 11, color: 'var(--dsw-alias-state-success-primary)' } },
              '● Ready',
            ),
          ),
        ),
      )
    }

    // The loader's factory contract: the return value IS the module exports
    // (do not use `module.exports` — `module` is not defined inside the
    // factory; the official bundles define `var module` themselves, returning
    // is the cleaner equivalent).
    return { apply, inject }
  },
})
