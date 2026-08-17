# linkhealth-intake-triage-dsh (plugin)

Self-contained **DeepSeek Harness (DSH)** plugin packaging of the LinkHealth
intake-triage system: one Skill (hub) that classifies/scores/routes an enquiry, three
spoke role prompts (leads) that draft scoping notes, and a **deterministic guardrail
backstop** — the DSH analogue of the Claude Code `PostToolUse` hook — that blocks any
triage-log write violating `phi_involved ⇒ requires_human_review`, independent of the
plugin's install location.

This is the DSH sibling of `triage-claude-plugin/` (Claude Code). Same system, same
rule set, different harness: DSH plugins are **npm packages that declare a
`dsh.bundle` patch layer** and are installed into a profile with `dsh plugin`.

## Contents

```
package.json                 npm manifest — declares the dsh.bundle patch layer
cordis.patch.yml             the bundle patch: one entry loading this package
lib/index.js                 Cordis plugin: registers skills, spokes, guardrail backstop, validate-triage-log tool
lib/validate.js              shared guardrail validation (JS) used by the backstop and the tool
skills/intake-triage/        the hub skill: classification + complexity scoring + routing decision
agents/*.md                  automation-lead, data-lead, deployment-lead spoke role prompts
scripts/validate_triage_log.py  standalone parity backstop (same rule set as lib/validate.js)
examples/synthetic_enquiries.jsonl   12 sample enquiries for a live demo
```

`examples/` is demo data only, not a test harness — for automated grading against
`expected_*` labels, use `data/eval_harness.py` in the source repo (root `README.md`),
which isn't bundled here since it depends on the `claude` CLI and repo-relative paths.

## What it registers (and how it works)

When the bundle loads, `lib/index.js` (`apply(ctx, config)`) registers, all against the
harness services it finds at boot and with zero runtime dependencies:

| Piece | DSH surface | Claude Code equivalent |
|---|---|---|
| Hub skill | `intake-triage` registered on `ctx.skills` (global layer) | `skills/intake-triage/SKILL.md` |
| Spokes | `automation-lead` / `data-lead` / `deployment-lead` registered as model-invocable skills; the hub dispatches them via the `subagent`/`subagent_fork` tool with the role text embedded in the delegation prompt | `.claude/agents/*.md` dispatched via the Agent tool |
| Guardrail (instruction) | SKILL.md Step 3 + a system-prompt section | SKILL.md Step 3 |
| Guardrail (deterministic) | `tools/post-execute` waterfall listener: any `write`/`edit` targeting a `data/triage_log.jsonl` re-reads the file and **blocks** the call when the appended record violates the rule (`{kind:'block'}`); plus the model-callable `validate-triage-log` tool and the standalone `scripts/validate_triage_log.py` | `.claude/hooks/validate_triage_log.py` (PostToolUse hook, exit 2) |

Notes on the mapping:

- **Spoke tool restriction is instruction-level in DSH.** The Claude spokes are
  runtime-restricted to `Read, Write`. In DSH the child inherits the parent's agent-preset
  toolset, so the spoke role prompts carry the restriction as an explicit boundary
  ("read and write files only") inside the delegation prompt. The isolation property —
  a fresh, isolated child context with no cross-enquiry bleed — is preserved: `spawn`
  children do not inherit parent conversation history.
- **The backstop cannot be skipped by forgetting the tool.** Unlike Claude Code (which
  fires the hook after every `Write`), the DSH backstop fires after every `write`/`edit`
  tool dispatch via `tools/post-execute` and blocks the result of a violating write.
  The `validate-triage-log` tool exists for explicit checks (and for log appends done
  through other means, e.g. a shell append).
- **Block semantics (same as the Claude Code hook).** The backstop runs *after* the file
  write, so a blocked write leaves the offending record on disk — the tool result is
  turned into a hard error the model must remediate, and every subsequent write to the
  log stays blocked until the last record is fixed (rewrite the log with a valid record,
  per SKILL.md Step 5). A block means a real violation; never work around it.

## Install

### Personal deployment — no pnpm needed

For your own machine (not distribution), skip the npm route entirely: the loader
imports an entry's `name` as a plain module specifier, so an **absolute path works
as-is**. Append one `insert` to the profile's user patch layer
(`~/.dsh/profiles/<profile>/cordis.patch.yml`, e.g. `web`):

```yaml
- insert:
    - id: linkhealth-intake-triage
      name: '/absolute/path/to/triage-dsh-plugin/lib/index.js'
      config:
        logPath: 'data/triage_log.jsonl'
```

No pnpm, no `dsh plugin` command, no changes to `package.json` or
`dsh.profile.bundles`. The patch layer is **hot-reloaded**, so the plugin activates
without a restart (verified live in the web profile). To remove it, delete the
`insert` block; to use it in another profile (e.g. `headless`), add the same block
there. The entry pins an absolute path — update it if the repo moves.

### Distribution route (npm package)

Requires the `dsh` CLI (`>= 0.1.0-rc.6`) and `pnpm` on `PATH` (`dsh plugin` forwards to
pnpm). Install from a local checkout or from a git/npm spec:

```sh
# from this repo (the plugin folder is a pnpm-installable package)
dsh plugin --profile web add /absolute/path/to/triage-dsh-plugin

# or by npm/git spec, e.g.
dsh plugin --profile web add linkhealth-intake-triage-dsh@latest
```

`dsh plugin` initializes the profile on first use, installs the package with pnpm, and
reconciles `dsh.profile.bundles` automatically (a package whose manifest declares
`dsh.bundle.patch` joins the layer stack). Then boot the profile:

```sh
dsh --profile web            # the browser UI — the skill and tools are live in every session
dsh --profile headless "triage enquiry E005 from examples/synthetic_enquiries.jsonl"
```

To verify the composed tree without booting:

```sh
dsh --profile <name> --dump-config
```

Uninstall: `dsh plugin --profile <name> remove linkhealth-intake-triage-dsh`.

## Usage

1. Present an enquiry (four fields: `raw_text`, `industry`, `org_size`,
   `stated_urgency`) — paste a case from `examples/synthetic_enquiries.jsonl`, e.g.
   *"triage case E002 in examples/synthetic_enquiries.jsonl"*.
2. The model loads the `intake-triage` skill and runs classify → score → guardrail →
   ambiguity → log → dispatch.
3. Every decision lands in `data/triage_log.jsonl`; the backstop validates each write;
   `validate-triage-log` confirms it on demand.

The system triages **business enquiries about LinkHealth's services** only. It never
triages patients and must never be presented as clinical decision support.

## Guardrail rule set (kept in three places on purpose)

The rule — all ten output fields present, and `phi_involved: true` ⇒
`requires_human_review: true` — is stated once as a model instruction (SKILL.md Step 3)
and enforced twice in code: `lib/validate.js` (in-process backstop + tool) and
`scripts/validate_triage_log.py` (standalone parity copy). They are intentionally
redundant; if you change the rule, change all three.

Standalone check:

```sh
python3 triage-dsh-plugin/scripts/validate_triage_log.py path/to/triage_log.jsonl
```

## Source of truth

This is a packaged copy for portability/distribution. The source project (architecture
doc `docs/PRD.md`, synthetic eval set, full test suite) lives at the repo root — see the
top-level `README.md`. The scoring rubric lives only in `skills/intake-triage/SKILL.md`;
don't duplicate it elsewhere.
