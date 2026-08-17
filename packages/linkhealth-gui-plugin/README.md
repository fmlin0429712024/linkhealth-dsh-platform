# linkhealth-gui-plugin

The **LinkHealth Agents front door** — a client-side DeepSeek Harness (DSH)
plugin that brands the web surface and exposes the product line's capabilities
(Triage, CDI Audit) as first-class entries. **Presentation only**: it adds no
business logic and imports no business plugin.

Spec: `docs/PRD-gui-plugin.md` · tasks: `docs/TASKS-gui-plugin.md`.

## What it does

| Piece | Registered as | Effect |
|---|---|---|
| Brand theme | `theme.overrideTokens` (light + dark, deep teal/blue) | global accents/brand colors |
| Capability launcher | `sidebar.footer.action` (additive) | one entry per configured capability; click starts a session |
| Capability showcase | `settings.section` (additive) | "LinkHealth Capabilities" cards with status |

Design rules: **additive only** (no default component replaced), **config-driven**
(a third capability is a config edit, not code), **reversible** (removing the
patch rows restores the stock UI).

## Install (personal deployment — no pnpm)

1. Link the package into the profile so the loader and the client-modules
   resolver can reach it:

   ```sh
   ln -s /absolute/path/to/linkhealth-gui-plugin ~/.dsh/profiles/<profile>/node_modules/linkhealth-gui-plugin
   ```

2. Append the entry to the profile's user patch layer
   (`~/.dsh/profiles/<profile>/cordis.patch.yml`, e.g. `web`):

   ```yaml
   - insert:
       - id: linkhealth-gui
         name: 'linkhealth-gui-plugin'
         config:
           headline: 'LinkHealth Agents'
           placeholder: 'Triage an enquiry, audit documentation — or describe what you need'
           capabilities:
             - id: triage
               label: Triage
               description: 'Classify, score, and route inbound business enquiries.'
             - id: cdi
               label: CDI Audit
               description: 'Governed clinical-documentation audit against SOP rules.'
   ```

3. **Restart the web server once** (Ctrl+C → `dsh web`), then refresh the
   browser. The client bundle is a first-class graph entry composed at boot —
   unlike host-side skills, a newly added client plugin is not picked up by the
   running process. After that, editing the plugin's files hot-reloads through
   the client-modules bundle watcher.

To remove: delete the `insert` block (and the `node_modules` link).

## Config contract

- `headline` / `placeholder` — branded welcome copy (used by the showcase).
- `capabilities[]` — each entry: `id` (string), `label` (string),
  `description` (string); extra keys allowed for forward compatibility.

## Testing

```sh
cd linkhealth-gui-plugin
node --test          # 22 unit tests for the pure logic (zero deps)
```

The pure logic lives in `lib/launcher-config.js` (single source of truth,
unit-tested). The browser half inlines the same logic because DSH client
bundles are self-contained (require() reaches only platform modules) — keep
them in sync; the tests are the contract.

## Known constraints (learned live)

- **DSH locale dictionaries cannot be overridden cross-package** (registering
  the same namespace + locale key throws), so the default hero copy is NOT
  branded; the welcome is carried by the launcher/cards instead.
- **`exports` must expose `./package.json`** — the client-modules resolver reads
  the manifest via `require.resolve('<pkg>/package.json')`, which fails under a
  restrictive `exports` map.
- **First inclusion of a client plugin needs one server restart** (the client
  graph is built at boot; HMR re-triggers only on entry *re-creation*).
- **A patch entry's `config` does NOT reach the client plugin** — the client
  graph passes only `id`/`url`/`inject`. The front-door configuration therefore
  lives as built-in defaults in `lib/client.js` (`BUILTIN_CONFIG`, one place to
  edit); if a config channel arrives later, `resolveConfig` merges it over.
- **`settings.section` is a single-select navigation**: a section's component
  renders only after its label ("LinkHealth Capabilities") is clicked — the
  capability cards live behind that tab, not on the settings landing view.
