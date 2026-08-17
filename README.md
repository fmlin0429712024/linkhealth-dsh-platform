# linkhealth-dsh-platform

DeepSeek Harness (DSH) plugins for [LinkHealth](https://github.com/fmlin0429712024)'s
AI-enablement services for healthcare. This repo is the dedicated home for the
**DSH packaging** of LinkHealth's capabilities — intake triage and clinical
documentation integrity (CDI) auditing — built on the [Cordis](https://cordisjs.dev/)
plugin runtime.

The core, non-DSH deliverables for each product line live in their own repos;
this repo only carries the DSH plugin layer:

- [`linkhealth-triage`](https://github.com/fmlin0429712024/linkhealth-triage) —
  the intake-triage system (Claude Code Skill + Agents + guardrail hook is the
  core deliverable; DSH packaging is a PoC section there).
- `clinical-documentation-audit-poc` — the CDI audit system and its `.agents/skills`
  source of truth.

## What's here

| Package | Plane(s) | Status | What it does |
| --- | --- | --- | --- |
| [`plugins/dsh-triage-plugin`](plugins/dsh-triage-plugin) | host | 🟢 active | Classifies/scores/routes inbound business enquiries; hub skill + 3 spoke role prompts + a deterministic guardrail backstop (`phi_involved` ⇒ `requires_human_review`, enforced in code independent of the model). |
| [`plugins/dsh-cdi-plugin`](plugins/dsh-cdi-plugin) | host (client half planned) | 🟢 active | Deterministic SOP-rule evaluation tools for CDI auditing, bundled SQLite rule stores, synthetic gold sets, and a packaged skills snapshot. |
| [`plugins/dsh-linkhealth-gui-plugin`](plugins/dsh-linkhealth-gui-plugin) | client | 🟡 early | Branded front door for the DSH web UI — theme, sidebar capability launcher, Settings showcase. Purely additive/reversible; presents both capabilities above without importing either (zero business coupling). Two of its four features are still stubs — see its own README. |

All data bundled in this repo (enquiry examples, SOP rule stores, patient gold
sets) is **synthetic/fictional** — no real patient, provider, or client data.

## Conventions

New plugins should follow the pattern already established by the three above:

- **Naming**: `dsh-<domain>-plugin` (e.g. `dsh-triage-plugin`). The folder
  under `plugins/` always matches the `package.json` `name` exactly — no
  divergence between the two.
- **One package per capability**, not split host/client packages. Host code
  is `lib/index.js` (export `.`); if a capability later grows a client/GUI
  half, it lives at `lib/client.js` in the *same* package (export `./client`)
  — see `dsh-linkhealth-gui-plugin`'s host-noop + client-real split, and
  `dsh-cdi-plugin`'s "Next: Step 2" section for a package planning to grow
  one. Don't create a second `dsh-<domain>-gui-plugin` package.
- **The front-door exception**: a plugin that only *presents* other
  capabilities without importing them (like `dsh-linkhealth-gui-plugin`)
  stays its own package rather than merging into any one capability.
- **Renaming checklist**: `package.json` `name`, `cordis.patch.yml`'s
  `insert[].name`, the header comment in `lib/index.js`/`lib/client.js`, and
  the package's own README all need to move together. The internal Cordis
  `export const name` / patch `insert[].id` values are a separate,
  independent identifier (a bundle-instance name) and don't need to match the
  npm package name — see `dsh-cdi-plugin`'s `id: cdi-plugin` vs. package name
  `dsh-cdi-plugin` for existing precedent.
- **Self-contained**: each plugin bundles its own test/demo data
  (`examples/`, `data/`) — no shared/general data folder. The two domains
  here don't overlap, so centralizing would only add indirection.

## The DSH plugin contract

Every package here is an npm package that plugs into a running DSH/Cordis
instance:

- `package.json` declares either `dsh.bundle.patch` (a host plugin, wired via
  `cordis.patch.yml`) or `dsh.client.platform` (a browser-loaded client
  plugin).
- The entry module (`lib/index.js` for host, `lib/client.js` for client)
  exports `name`, `inject` (the Cordis services it needs, e.g. `tools`,
  `skills`, `theme`), a config schema, and `apply(ctx, config)`, which
  registers behavior and returns a disposer for clean teardown — every
  plugin here is fully reversible.
- Host plugins register tools (`ctx.tools.register`) and/or skills
  (`ctx.skills.registerProvider`); client plugins inject into UI slots
  (`sidebar.footer.action`, `settings.section`, theme tokens).

Each package's own README has the exact install steps for wiring it into a
DSH profile (`~/.dsh/profiles/<name>/`).

## Prerequisites

These plugins target [DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/cordis)
— you need a working DSH installation to actually run them. The
`@deepseek-ai/*` peer packages (`cordis`, `dsh-tools`, `dsh-skill`,
`schemastery`, `dsh-client-runtime`, `dsh-client-ui-primitives`) are published
on the public npm registry and are provided by a DSH install, not by this
repo.

## Development

This is a [pnpm workspace](https://pnpm.io/workspaces) monorepo.

```sh
pnpm install
pnpm test   # runs each package's test suite where one exists
```

`dsh-triage-plugin` and `dsh-linkhealth-gui-plugin` ship automated tests
(`pnpm test` runs both — `node --test` for the GUI plugin's pure logic,
`python3` for the triage guardrail script, zero external dependencies
either way). `dsh-cdi-plugin` is verified via the manual smoke checklist in
its own README.

## Deployment (GCP)

This repo is the **single source of truth** for the DSH plugins — the GCP VM
is provisioned and deployed exclusively from `plugins/` here:

- `deploy/profile-linkhealth/` — the deployable profile (triage + CDI + GUI
  patch rows, relative paths).
- `deploy/scripts/bootstrap-vm.sh` — one-time VM provisioning (Node 22, dsh
  CLI, release layout, systemd unit).
- `deploy/scripts/deploy.sh` — per-release: unpack → wire CDI module
  resolution → switch `current` symlink → restart → health check.
- `.github/workflows/deploy.yml` — CI/CD: build the self-contained release
  tarball from `plugins/`, upload, deploy.
- [docs/deployment-gcp.md](docs/deployment-gcp.md) — the full playbook
  (VM provisioning, secrets, port map, rollback).

## License

MIT — see [LICENSE](LICENSE).
