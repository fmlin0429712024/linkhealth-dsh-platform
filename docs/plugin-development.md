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
| L3 — headless E2E (optional, future) | `dsh --profile headless "<task>"` — boot a real profile, run one task, assert the output markers | LLM tokens, ~30–60s | push-to-main / workflow_dispatch (needs `DEEPSEEK_API_KEY`) |
| L4 — deploy verification | the Deploy workflow's health check on the VM | free | push to main (deploy) |

**Why fork PRs only get L1+L2**: GitHub does not expose repository secrets to
pull requests from forks. Any LLM-backed test (L3) needs the DeepSeek API
key, so it can only run on same-repo pushes or manual dispatch.

## Local development loop

```sh
pnpm install
pnpm test                 # all plugin tests
pnpm test:contract        # contract self-check
# full local stack (all plugins from this repo):
dsh --profile linkhealth2 --port 3083
# headless single-task run (L3 prototype):
dsh --profile headless "list the CDI rules with cdi_list_rules"
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

## Conventions enforced by CI

- Folder name == `package.json` `name`; name matches `dsh-<domain>-plugin`.
- Host plugins export `name` / `inject` / `apply` from the entry module;
  client plugins declare `dsh.client.platform`.
- Every package has a README and a test entry.
- One package per capability (host + optional client half in the same
  package, `./client` export) — see the root README "Conventions".

See also: [deployment-gcp.md](deployment-gcp.md) for the VM/CI-CD playbook.
