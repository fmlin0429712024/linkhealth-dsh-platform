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

Every plugin package follows the `dsh-<domain>-plugin` naming convention, and
each bundles its host and client halves as one package (`.` / `./client`)
rather than splitting them across separate packages.

| Package | Plane(s) | What it does |
| --- | --- | --- |
| [`plugins/dsh-triage-plugin`](plugins/dsh-triage-plugin) | host | Classifies/scores/routes inbound business enquiries; hub skill + 3 spoke role prompts + a deterministic guardrail backstop (`phi_involved` ⇒ `requires_human_review`, enforced in code independent of the model). |
| [`plugins/dsh-cdi-plugin`](plugins/dsh-cdi-plugin) | host (client half planned, not started) | Deterministic SOP-rule evaluation tools for CDI auditing, bundled SQLite rule stores, synthetic gold sets, and a packaged skills snapshot. |
| [`plugins/dsh-linkhealth-gui-plugin`](plugins/dsh-linkhealth-gui-plugin) | client | Branded front door for the DSH web UI — theme, sidebar capability launcher, Settings showcase. Purely additive/reversible; presents both capabilities above without importing either (zero business coupling). |

All data bundled in this repo (enquiry examples, SOP rule stores, patient gold
sets) is **synthetic/fictional** — no real patient, provider, or client data.

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

Only `dsh-linkhealth-gui-plugin` currently ships automated tests
(`node --test`, zero dependencies). The other packages are verified via the
manual smoke checklists documented in their own READMEs.

## License

MIT — see [LICENSE](LICENSE).
