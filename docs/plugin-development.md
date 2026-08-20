# Plugin development & CI/CD — how to add a new plugin (by anyone)

This repo is the **single source of truth** for LinkHealth's DSH plugins and
the CI/CD pipeline that tests and deploys them. This guide is the contract
for **adding a new plugin** — including plugins from outside contributors —
so every package gets tested automatically, in the same way, before merge.

## The pipeline at a glance

```
PR opened (any source)            push to main
  → CI (ci.yml)                     → CI (ci.yml)          → Deploy (deploy.yml)
      pnpm test (all plugins)           same checks            build release from plugins/
      plugin contract check             + Deploy workflow      upload → deploy.sh → health check
```

- **PR gate (free, stable, fork-safe)**: `pnpm test` (each plugin's own
  deterministic tests) + the zero-dependency plugin contract check. No
  secrets involved, so it runs on pull requests from forks too.
- **Deploy gate (needs secrets)**: push to `main` touching `plugins/**`,
  `deploy/**`, or the workflows rebuilds the release from `plugins/` and
  deploys to the VM. Secrets are repo-scoped, so fork PRs can never trigger
  a deploy — by design.

## Adding a new plugin — the checklist

1. **Create the package** under `plugins/`:
   ```
   plugins/dsh-<domain>-plugin/
     package.json          # name == folder name, dsh-<domain>-plugin
     cordis.patch.yml      # if host (dsh.bundle.patch)
     lib/index.js          # host entry: export name / inject / Config / apply
     lib/client.js         # optional client half (export ./client)
     README.md             # authoritative install/config doc
     scripts/test_*.py     # OR package.json "scripts.test"
   ```
2. **Declare the DSH side** in `package.json` — host:
   `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`, client:
   `"dsh": { "client": { "platform": "web" } }`.
3. **Add a test entry** — either `"scripts": { "test": "..." }` (auto-run by
   `pnpm test` via the workspace `-r --if-present` recursion) or a
   `scripts/test_*.py` file. Keep it deterministic and stdlib-only where
   possible (see the testing tiers below).
4. **That's it.** The contract check in CI verifies 1–3 automatically for
   every package — there is no registry to join, no per-plugin CI config.

## Testing tiers

| Tier | What | Cost | Runs on |
|---|---|---|---|
| L1 — deterministic logic | plugin's own `scripts/test_*.py` / `npm test` (guardrail, rule tools, pure UI logic) | free, <1s | PR + main |
| L2 — plugin contract | `node scripts/check-plugin-contract.mjs`: naming, dsh declaration, referenced paths, README, test entry, Cordis exports | free, <1s | PR + main |
| L3 — headless E2E | `scripts/e2e-smoke.sh`: boot a real headless DSH profile with the plugins from the checkout, run fixed LLM tasks, assert output markers | LLM tokens, ~2–3 min | push to main — **pre-deploy gate in deploy.yml** |
| L4 — deploy verification | the Deploy workflow's health check on the VM | free | push to main (deploy) |

**Why fork PRs only get L1+L2**: GitHub does not expose repository secrets to
pull requests from forks. Any LLM-backed test (L3) needs the DeepSeek API
key, so it can only run on same-repo pushes or manual dispatch.

The whole flow is documented end-to-end in **[ci-cd.md](ci-cd.md)** — follow
that document and every new plugin gets the full pipeline automatically.

## Local development loop

```sh
pnpm install
pnpm test                 # all plugin tests
pnpm test:contract        # contract self-check
# full local stack (all plugins from this repo):
dsh --profile linkhealth2 --port 3083
# the exact E2E gate CI runs (needs DEEPSEEK_API_KEY in the test home):
DSH_HOME=$PWD/.dsh-e2e-home bash scripts/e2e-smoke.sh
```

## Wiring a new plugin into the deployed profile

The deploy unit (`deploy/profile-linkhealth/cordis.patch.yml`) lists the
business plugins; the Deploy workflow (`deploy/scripts/../.github/workflows/deploy.yml`)
copies `plugins/` into the release. To ship a new host plugin:

1. Add its patch row to `deploy/profile-linkhealth/cordis.patch.yml`
   (relative `name: './plugins/<pkg>/lib/index.js'`, plus any config).
2. Add `cp -r plugins/<pkg> dist/profile/plugins/` to the workflow's build
   step.
3. If it imports `@deepseek-ai/*` directly, it needs the per-release module
   wiring that `deploy.sh` already creates for `dsh-cdi-plugin` (see the
   "Wire CDI module resolution" step in `deploy/scripts/deploy.sh`) — mirror
   it for the new package.

Client plugins are loaded by name: symlink them into
`dist/profile/node_modules/` in the build step (like
`dsh-linkhealth-gui-plugin`).

## Adopting an existing plugin (vs. building a new one)

Not every capability needs a plugin we author. If a solid, actively
maintained plugin already exists in the wider DSH ecosystem and does what's
needed, **adopt it instead of rebuilding it** — this repo's first case is
`dsh-vision-router` (gives the text-only main model "eyes" for image
attachments).

**Bar for adoption**: actively maintained, real published package, genuine
adoption signal (not a one-person weekend repo). We're trusting someone
else's code and update cadence, not just their API shape.

**How it differs from building one:**

- It does **not** live under `plugins/`, is **not** part of the pnpm
  workspace, and is **not** checked by `scripts/check-plugin-contract.mjs`
  (that check only scans `plugins/*`) — there's no package.json/README/test
  entry of ours to maintain, because the code isn't ours.
- It's declared with a single row in
  `deploy/profile-linkhealth/cordis.patch.yml` (`insert: - id: ... / name:
  '<npm-package-name>'`), installed straight from npm into the release
  profile's `node_modules` at deploy time (see the Deploy workflow's build
  step) — never copied into `plugins/`.
- **Documentation is deliberately lighter than a self-built plugin**: one
  row in the root [README.md](../README.md#whats-here) "adopted" table
  (name, npm link, one-line purpose) plus an inline comment on its
  `cordis.patch.yml` row explaining what it does and why it was adopted.
  No dedicated README or PRD of our own — we don't own the code, so we
  don't carry the documentation burden of owning it.
- **If real configuration/integration work is layered on top** (e.g.
  pointing it at a locally-deployed model instead of its default backend),
  that wiring is operationally significant enough to need its own place —
  don't try to cram it into the one-line inventory entry. Put it wherever
  the rest of that integration's operational detail already lives (for
  `dsh-vision-router` → local Phi-3.5-vision, that's
  [deployment-gcp.md](deployment-gcp.md), since it's fundamentally about how
  two production VMs are wired together — not a new file just for this).

## Conventions enforced by CI

- Folder name == `package.json` `name`; name matches `dsh-<domain>-plugin`.
- Host plugins export `name` / `inject` / `apply` from the entry module;
  client plugins declare `dsh.client.platform`.
- Every package has a README and a test entry.
- One package per capability (host + optional client half in the same
  package, `./client` export) — see the root README "Conventions".

See also: [deployment-gcp.md](deployment-gcp.md) for the VM/CI-CD playbook.
