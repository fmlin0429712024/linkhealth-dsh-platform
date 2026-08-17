// linkhealth-intake-triage-dsh — the DSH (DeepSeek Harness) plugin entry.
//
// This module is loaded by the Cordis loader as one bundle entry
// (`name: 'linkhealth-intake-triage-dsh'` in cordis.patch.yml). Its `apply()`
// registers everything the LinkHealth intake-triage system needs against the
// harness services it finds at boot:
//
//   1. the `intake-triage` hub skill and the three spoke role prompts
//      (`automation-lead`, `data-lead`, `deployment-lead`) on `ctx.skills`
//      (global layer → visible to every agent and session);
//   2. a `tools/post-execute` waterfall listener that deterministically
//      BLOCKS any `write`/`edit` call whose target is a
//      `data/triage_log.jsonl` and whose appended record violates the
//      guardrail — the DSH analogue of the Claude Code PostToolUse hook;
//   3. the `validate-triage-log` tool (explicit check the model can call);
//   4. a system-prompt section reminding the model of the guardrail contract.
//
// Design constraints honored here:
//   - No imports from `@deepseek-ai/*` packages: every service is read via
//     `ctx.get(...)` and tools are registered as plain descriptors, so the
//     package has zero runtime dependencies and cannot drift from the
//     harness's copy of a service definition.
//   - Skill bodies are read from the bundled `skills/` / `agents/` files at
//     apply time (single source of truth on disk, no content duplication).
//   - All registrations return disposers; `apply()` returns a combined
//     disposer so stopping/updating the entry tears everything down.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { isTriageLogPath, validateLogFile } from './validate.js'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readResource = (relative) => readFileSync(path.join(PKG_ROOT, relative), 'utf8')

/** The bundle entry id; also the prompt-section namespace. */
export const name = 'linkhealth-intake-triage'

/**
 * Hard service dependencies. Declaring them (the same pattern every first-
 * party DSH tool package uses) makes the loader wait until the services are
 * available before running `apply()` — without this, `ctx.get('skills')`
 * inside `apply()` can race plugin activation and return undefined, silently
 * skipping registration.
 */
export const inject = ['skills', 'tools', 'systemPrompt']

/** Entry config defaults (overridable via the patch row's `config`). */
export const config = {
  /** Triage log path used as the `validate-triage-log` tool default. */
  logPath: 'data/triage_log.jsonl',
}

/** Parse `---`-fenced YAML frontmatter (single-line scalars only). */
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { metadata: {}, body: text }
  const metadata = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (kv) metadata[kv[1]] = kv[2]
  }
  return { metadata, body: text.slice(match[0].length) }
}

/** One spoke registration: file, kebab-case skill name, description, whenToUse. */
const SPOKES = [
  {
    file: 'agents/automation-lead.md',
    name: 'automation-lead',
    description: 'Virtual spoke for Process & Workflow Automation enquiries handed off by the intake-triage skill. Drafts a short scoping note and clarifying questions — never runs on an enquiry directly, only on already-classified output.',
    whenToUse: 'After intake-triage classifies an enquiry as Process & Workflow Automation and clears it for dispatch; load this role to dispatch the spoke subagent.',
  },
  {
    file: 'agents/data-lead.md',
    name: 'data-lead',
    description: 'Virtual spoke for Documentation & Data Analytics enquiries handed off by the intake-triage skill. Drafts a short scoping note and clarifying questions — never runs on an enquiry directly, only on already-classified output.',
    whenToUse: 'After intake-triage classifies an enquiry as Documentation & Data Analytics and clears it for dispatch; load this role to dispatch the spoke subagent.',
  },
  {
    file: 'agents/deployment-lead.md',
    name: 'deployment-lead',
    description: 'Virtual spoke for Onsite Automation & Robotics Deployment enquiries handed off by the intake-triage skill. Drafts a short scoping note and clarifying questions — never runs on an enquiry directly, only on already-classified output.',
    whenToUse: 'After intake-triage classifies an enquiry as Onsite Automation & Robotics Deployment and clears it for dispatch; load this role to dispatch the spoke subagent.',
  },
]

/** Build the guardrail-feedback text shown when a write is blocked. */
function blockFeedback(reason) {
  return [{ type: 'text', text: `[guardrail] BLOCKED: ${reason}` }]
}

/** Render the validate-triage-log tool result for the model. */
// The registry invokes `output.render(exec.arguments, value)` — the result
// value is the SECOND parameter; the first is the call arguments.
function renderValidation(args, value) {
  const headline =
    value.checked === false
      ? 'validate-triage-log: nothing to validate (no records yet)'
      : value.ok
        ? 'validate-triage-log: PASS — last record satisfies the guardrail'
        : 'validate-triage-log: FAIL — last record violates the guardrail'
  return [{ type: 'text', text: value.reason ? `${headline}\n${value.reason}` : headline }]
}

export function apply(ctx, entryConfig) {
  const { logPath = config.logPath } = entryConfig ?? {}
  const disposers = []

  const skills = ctx.get('skills')
  const tools = ctx.get('tools')
  const systemPrompt = ctx.get('systemPrompt')

  // ── 1. Skills: hub + spokes (global layer) ────────────────────────────────
  // NOTE: the registry's `register()` supplies `invocation` and `provider`
  // defaults but NOT `source` — a registration without `source` fails later
  // with "loaded skill ... source must be a string" when the model loads it.
  if (skills) {
    const hub = parseFrontmatter(readResource('skills/intake-triage/SKILL.md'))
    disposers.push(
      skills.register({
        name: 'intake-triage',
        source: 'runtime',
        description: hub.metadata.description || 'Classifies and routes inbound LinkHealth business enquiries by service line, complexity, and urgency, with a mandatory PHI/compliance guardrail.',
        ...(hub.metadata.whenToUse ? { whenToUse: hub.metadata.whenToUse } : {}),
        content: hub.body,
      }),
    )
    for (const spoke of SPOKES) {
      const parsed = parseFrontmatter(readResource(spoke.file))
      disposers.push(
        skills.register({
          name: spoke.name,
          source: 'runtime',
          description: spoke.description,
          whenToUse: spoke.whenToUse,
          content: parsed.body,
        }),
      )
    }
  } else {
    ctx.logger?.warn('[linkhealth-intake-triage] skills service unavailable — skills not registered')
  }

  // ── 2. Guardrail backstop: block invalid triage-log writes ────────────────
  // Fires after every tool dispatch. Only `write`/`edit` calls whose target
  // is a `data/triage_log.jsonl` are checked; the file is re-read from disk
  // (never trusting the model's reported content), and a violation turns the
  // tool result into a blocked error the model cannot ignore.
  // NOTE (learned live on the VM): the log path must resolve against the
  // SESSION workspace (exec.agent.session.header.cwd), NOT process.cwd() —
  // the service runs from the release directory while the session works in a
  // separate workspace, and resolving against the wrong root silently skips
  // the check (validates a non-existent file → pass).
  const workspaceCwd = (exec) => exec?.agent?.session?.header?.cwd || process.cwd()
  const onPostExecute = async (exec, result, next) => {
    try {
      if (
        (exec?.name === 'write' || exec?.name === 'edit') &&
        isTriageLogPath(exec?.arguments?.file_path)
      ) {
        const target = path.resolve(workspaceCwd(exec), String(exec.arguments.file_path))
        const verdict = validateLogFile(target)
        if (!verdict.ok) {
          return { kind: 'block', feedback: blockFeedback(verdict.reason) }
        }
      }
    } catch (error) {
      // A listener must never take the pipeline down with it; log and accept.
      ctx.logger?.warn(`[linkhealth-intake-triage] guardrail check failed: ${String(error?.message ?? error)}`)
    }
    return next()
  }
  disposers.push(ctx.on('tools/post-execute', onPostExecute))

  // ── 3. The validate-triage-log tool (explicit, model-callable) ────────────
  // Note: call `tools.register(...)` on the service directly — detaching the
  // method (`const register = tools.register`) loses `this` and the registry
  // fails on `this.layers`.
  if (tools) {
    disposers.push(
      tools.register({
        name: 'validate-triage-log',
        description:
          'Validate the last triage decision appended to the LinkHealth triage log against the guardrail: all ten required fields present, and phi_involved=true implies requires_human_review=true. Call this after appending a decision to the triage log (the automatic post-write backstop also runs), or any time you suspect a record violates the guardrail. Missing file or empty log is a pass.',
        parameters: {
          type: 'object',
          properties: {
            log_path: {
              type: 'string',
              description: `Path to the triage log (defaults to ${logPath} relative to the workspace root).`,
            },
          },
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              checked: { type: 'boolean' },
              reason: { type: 'string' },
            },
            required: ['ok', 'checked'],
          },
          render: renderValidation,
        },
        async execute(args, exec) {
          // Default log path resolves against the session workspace (not
          // process.cwd()) — see the note on the post-execute backstop above.
          const base = exec?.agent?.session?.header?.cwd || process.cwd()
          const target = args?.log_path ? path.resolve(base, String(args.log_path)) : path.resolve(base, logPath)
          return validateLogFile(target)
        },
      }),
    )
  } else {
    ctx.logger?.warn('[linkhealth-intake-triage] tools service unavailable — validate-triage-log tool not registered')
  }

  // ── 4. Prompt section: keep the guardrail contract in front of the model ──
  if (systemPrompt) {
    disposers.push(
      systemPrompt.section({
        name: 'linkhealth-intake-triage',
        order: 240,
        text:
          'LinkHealth intake triage is available via the `intake-triage` skill. When you triage an enquiry: log the decision to data/triage_log.jsonl, then call `validate-triage-log` to confirm the guardrail passed. The `tools/post-execute` backstop blocks invalid writes automatically — if a write to the triage log is blocked, fix the record (all ten fields, and phi_involved=true always implies requires_human_review=true); never work around the block.',
      }),
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
