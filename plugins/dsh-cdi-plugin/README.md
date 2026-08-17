# dsh-cdi-plugin

**Step 1 of the CDI-on-DSH roadmap: a pure host plugin running on the AS-IS
DSH GUI.** It packages the synthetic CDI (clinical documentation integrity)
auditing domain for DeepSeek Harness — the deterministic SOP-rule evaluation
tools, the SQLite SOP stores, the synthetic gold sets, the audit rules, and a
snapshot of the CDI skills — with **zero user-interface changes**.

> Everything here is synthetic/fictional. No real patient, provider, or
> client data. No output is a clinical, coding, billing, or compliance
> decision — every finding stays `requires_human_review`.

## What the plugin does

| Piece | What it provides |
| --- | --- |
| `cdi_query_rule` tool | Evaluate **one** deterministic SOP rule against **one** record via the SQLite SOP store. The LLM never judges the threshold — the tool's result is final (same contract as `tools/query_deterministic_rule.py`). |
| `cdi_list_rules` tool | List every deterministic rule in the bundled stores (`shared` = `audit_rules.db`, `multi-domain` = `audit_rules-multi-domain.db`). |
| `skills/` | Packaged snapshot of the 8 CDI skills. The built-in filesystem provider already discovers them from the repo's `.agents/skills`; the plugin can also serve them itself (`bundledSkills: true`) for deployments with no repo skill tree. |
| `data/` + `rules/` | Bundled SOP stores (`.db`), synthetic gold sets, and the illustrative audit rules — the plugin is self-contained. |

Skills themselves are **not** registered by this plugin when `bundledSkills`
is off (default): in this workspace the built-in `dsh-skill-filesystem`
provider already discovers the identical skills from `.agents/skills`
(project root = nearest `.git` ancestor). A second provider would only
duplicate the catalog.

## Layout

```
plugins/
  dsh-cdi-plugin/
    package.json            # Cordis plugin package manifest (+ dsh.bundle.patch)
    cordis.patch.yml        # bundle patch: inserts the cdi-plugin row
    lib/index.js            # host half: name / inject / Config / apply
    lib/client.js           # client half (Step 2, not started yet) — exports["./client"]
    tools/query_deterministic_rule.py   # copy of the POC rule tool (stdlib only)
    data/                   # bundled SOP stores + synthetic gold sets
    rules/synthetic-audit-rules.md      # illustrative rules (not policy)
    skills/<name>/SKILL.md  # packaged snapshot of the 8 CDI skills
```

Host and client live in **one package** (`.` = host, `./client` = client), the
same pattern `dsh-linkhealth-gui-plugin` uses — not two separate packages.

> Originally developed at
> `clinical-documentation-audit-poc/dsh-plugins/cdi`; this copy lives here as
> part of the `linkhealth-dsh-platform` DSH plugin monorepo. See "Sync rules"
> below for how the bundled skills/data/tools relate to that origin repo.

## Install into the running web profile

The plugin is a Cordis bundle: it must be (a) installed into the profile's
`node_modules` and (b) listed in `dsh.profile.bundles`, then the `dsh web`
process restarted. Two equivalent routes:

```sh
# Route 1 — pnpm (needs pnpm on PATH)
cd ~/.dsh/profiles/web
pnpm add file:/Users/fmlin/Documents/linkhealth-dsh-platform/plugins/dsh-cdi-plugin
# (the `dsh plugin --profile web add ...` wrapper also reconciles bundles automatically)

# Route 2 — manual symlink (no pnpm needed), plus a package.json edit
ln -s /Users/fmlin/Documents/linkhealth-dsh-platform/plugins/dsh-cdi-plugin \
      ~/.dsh/profiles/web/node_modules/dsh-cdi-plugin
# then add "dsh-cdi-plugin" to dependencies and to dsh.profile.bundles
# in ~/.dsh/profiles/web/package.json
```

Either way the profile manifest gains the bundle:

```jsonc
// ~/.dsh/profiles/web/package.json
"dsh": { "profile": { "bundles": [ "...", "dsh-cdi-plugin" ] } },
"dependencies": { "...", "dsh-cdi-plugin": "link:..." }
```

## Module resolution (dev wiring)

The profile's `dsh-cdi-plugin` is a **symlink** into this repo, so Node
resolves the plugin's own imports from the repo (not the profile). The
plugin therefore carries one dev-only wiring symlink:

```
plugins/dsh-cdi-plugin/node_modules/@deepseek-ai -> ~/.dsh/profiles/node_modules/@deepseek-ai
```

That target is the dsh installation's flat module fallback (one symlink per
package in the app closure), so `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-skill`,
`@deepseek-ai/schemastery`, and `@deepseek-ai/cordis` all resolve from the
plugin's real location. Re-create it after a clean checkout or a dsh
reinstall:

```sh
mkdir -p plugins/dsh-cdi-plugin/node_modules
ln -sfn ~/.dsh/profiles/node_modules/@deepseek-ai plugins/dsh-cdi-plugin/node_modules/@deepseek-ai
```

(`node_modules` here is git-ignored — machine-specific wiring.)

## Verify (no UI change)

In a new DSH session, ask something like:

> 对 `data/synthetic-ichd-patient-goldset.json` 跑一次完整 CDI 审计

or directly exercise the tools:

> 用 cdi_list_rules 列出规则目录,然后用 cdi_query_rule 对第一个
> clinical_treatments[] 条目逐条跑 SYN-ICHD-01 / SYN-ICHD-09

The model should call the native tools (cards titled "Query rule …" in the
conversation) instead of shelling out to python — and the
`deterministic-rule-audit` skill now prefers them (`fallback:
tools/query_deterministic_rule.py`).

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `python` | `python3` | Interpreter used for the bundled rule tool. |
| `bundledSkills` | `false` | Serve `skills/` through a provider named `cdi-bundled` (for deployments without a repo `.agents/skills`). |
| `dataRoot` | (bundled `data/`) | Point at the repo root instead of the bundled stores — dev-only convenience. |

## Sync rules

- `skills/` is a **snapshot**: the source of truth is
  `clinical-documentation-audit-poc`'s `.agents/skills` (a separate repo from
  this one). When those change, re-copy
  (`cp -r .agents/skills/*/SKILL.md plugins/dsh-cdi-plugin/skills/` per
  skill, run from `clinical-documentation-audit-poc`, then copy the result
  into this repo), keeping `.agents`, `.claude`, and this plugin's snapshot
  identical.
- `tools/`, `data/`, `rules/` are copies too — same rule, same origin repo.

## Next: Step 2 (preview)

`lib/client.js`, exported as `./client` from this same package (not a
separate package — see "Layout" above), will add a **client half**: a
browser bundle that registers the CDI domain UI into the shell's slots:
audit-finding cards in `conversation`, evidence/rule detail in `details`, a
human review workbench in `shell.overlay`, and CDI settings in
`settings.plugins.tab`. Same host logic, enterprise-flavored UI. Not started
yet — `package.json` will need a `dsh.client.platform` declaration and an
`exports["./client"]` entry added once this lands.
