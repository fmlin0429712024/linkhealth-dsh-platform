// dsh-vision-plugin — host entry.
//
// Loaded by the Cordis loader as one bundle entry (`name: 'dsh-vision-plugin'`
// in cordis.patch.yml, bundle-instance id `linkhealth-vision`). `apply()`
// registers the plugin's first real tool, `assess_exercise_form`, against the
// harness services it finds at boot:
//
//   1. `assess_exercise_form` on `ctx.tools` — sends one photo to the
//      configured vision backend (`/v1/pose`), computes the elbow angle
//      deterministically from the returned keypoints, and reports whether
//      the held position matches the expected exercise phase;
//   2. a system-prompt section describing the tool and its contract.
//
// Design constraints honored here (same as every other plugin in this repo):
//   - No imports from `@deepseek-ai/*` packages: every service is read via
//     `ctx.get(...)` and the tool is registered as a plain descriptor, so the
//     package has zero runtime dependencies.
//   - Deterministic tool decides, LLM only narrates: the geometry rule in
//     `./pose.js` is final, exactly like `dsh-cdi-plugin`'s `cdi_query_rule`.
//   - The vision backend is never hardcoded: it is the `baseUrl` config entry
//     (only instance today: `http://10.128.0.11:8080` on the GCP VPC — see
//     infra/openvino-vision/README.md).
//   - All registrations return disposers; `apply()` returns a combined
//     disposer so stopping/updating the entry tears everything down.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { assessExerciseForm } from './pose.js'

/** The bundle entry id; also the prompt-section namespace. */
export const name = 'linkhealth-vision'

/** Hard service dependencies — see the triage plugin for why this matters:
 * without them, `ctx.get(...)` inside `apply()` can race plugin activation
 * and return undefined, silently skipping registration. */
export const inject = ['tools', 'systemPrompt']

/** Entry config defaults (overridable via the patch row's `config`). */
export const config = {
  /**
   * Base URL of the vision backend (`GET /health`, `POST /v1/pose`).
   * Unset by default — the tool raises a configuration error until this is
   * pointed at a running backend (e.g. http://10.128.0.11:8080 on the VPC).
   */
  baseUrl: '',
  /**
   * Per-keypoint confidence floor for the exercise-form rule; matches the
   * backend's own CONF_THRESHOLD (0.1). Joints below this are treated as not
   * detected and produce `insufficient_evidence`.
   */
  confidenceThreshold: 0.1,
}

/** How long a backend request may take before it is aborted. */
const FETCH_TIMEOUT_MS = 30_000

/** Resolve a tool-supplied image path against the session workspace. */
function resolveImagePath(exec, imagePath) {
  const base = exec?.agent?.session?.header?.cwd || process.cwd()
  return path.resolve(base, String(imagePath))
}

/**
 * POST one image to `<baseUrl>/v1/pose` and return the parsed JSON body.
 * Multipart field name `file` matches infra/openvino-vision/serve.py.
 */
async function callPoseBackend(baseUrl, imagePath) {
  let bytes
  try {
    bytes = await readFile(imagePath)
  } catch (error) {
    throw new Error(`could not read image file ${imagePath}: ${String(error?.message ?? error)}`)
  }
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/pose`
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), path.basename(imagePath))

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`vision backend request to ${url} failed: ${String(error?.message ?? error)}`)
  }

  if (!response.ok) {
    const snippet = String(await response.text()).slice(0, 200)
    throw new Error(`vision backend returned HTTP ${response.status}: ${snippet || '(empty body)'}`)
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new Error(`vision backend returned non-JSON from ${url}`)
  }
  if (!body || typeof body.keypoints !== 'object') {
    throw new Error(`vision backend response from ${url} is missing the keypoints field`)
  }
  return body
}

/** Render the assess_exercise_form result for the model. */
function renderAssessment(_args, value) {
  const lines = [
    `assess_exercise_form: ${value.status}`,
    `  side: ${value.side}`,
  ]
  if (value.elbow_angle_deg !== null) {
    lines.push(`  elbow angle: ${value.elbow_angle_deg}° (${value.phase})`)
  }
  if (value.avg_confidence !== null) {
    lines.push(`  avg keypoint confidence: ${value.avg_confidence}`)
  }
  if (value.expected_phase !== null) {
    lines.push(`  expected phase: ${value.expected_phase} — form ${value.form_ok ? 'OK' : 'NOT OK'}`)
  }
  lines.push(`  reason: ${value.reason}`)
  return [{ type: 'text', text: lines.join('\n') }]
}

export function apply(ctx, entryConfig) {
  const { baseUrl = config.baseUrl, confidenceThreshold = config.confidenceThreshold } = entryConfig ?? {}
  const disposers = []

  const tools = ctx.get('tools')
  const systemPrompt = ctx.get('systemPrompt')

  // ── 1. The assess_exercise_form tool ──────────────────────────────────────
  // Registered unconditionally (even without a baseUrl): the model sees the
  // capability in the catalog, and calling it without configuration fails
  // loudly instead of silently. `tools.register(...)` must be called on the
  // service directly — detaching the method loses `this`.
  if (tools) {
    disposers.push(
      tools.register({
        name: 'assess_exercise_form',
        description:
          'Assess a single photo of a PT/rehab exercise (currently bicep-curl elbow form): send it to the configured ' +
          'vision backend, compute the elbow angle deterministically from the pose keypoints, and report whether the ' +
          'held position matches the expected phase (extended >= 150°, curled <= 60°). The tool\'s geometry verdict is ' +
          'final — never judge the angle yourself, only narrate the result. A single frame assesses a HELD position only, ' +
          'not range of motion across a rep; the subject must be standing or seated (the pose model is unreliable on a ' +
          'lying subject). Low-confidence or missing arm keypoints yield insufficient_evidence rather than a guess.',
        parameters: {
          type: 'object',
          properties: {
            image_path: {
              type: 'string',
              description: 'Path to the photo (JPG/PNG), relative to the session workspace or absolute.',
            },
            expected_phase: {
              type: 'string',
              enum: ['extended', 'curled'],
              description: 'Optional prescribed held phase to check the measured angle against (form_ok).',
            },
            side: {
              type: 'string',
              enum: ['left', 'right', 'auto'],
              description: "Which arm to assess. Default 'auto': the confidently detected arm, preferring the higher average confidence when both qualify.",
            },
          },
          required: ['image_path'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              status: { type: 'string', enum: ['assessed', 'insufficient_evidence'] },
              side: { type: 'string', enum: ['left', 'right', 'none'] },
              elbow_angle_deg: { oneOf: [{ type: 'number' }, { type: 'null' }] },
              avg_confidence: { oneOf: [{ type: 'number' }, { type: 'null' }] },
              phase: { oneOf: [{ type: 'string', enum: ['extended', 'curled', 'mid_range'] }, { type: 'null' }] },
              expected_phase: { oneOf: [{ type: 'string', enum: ['extended', 'curled'] }, { type: 'null' }] },
              form_ok: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
              reason: { type: 'string' },
            },
            required: ['status', 'side', 'elbow_angle_deg', 'avg_confidence', 'phase', 'reason'],
          },
          render: renderAssessment,
        },
        timeoutMs: FETCH_TIMEOUT_MS,
        async execute(args, exec) {
          if (!baseUrl) {
            throw new Error(
              'assess_exercise_form: vision backend not configured — set the dsh-vision-plugin `baseUrl` config ' +
              '(e.g. http://10.128.0.11:8080 on the LinkHealth VPC)',
            )
          }
          const imagePath = resolveImagePath(exec, args?.image_path)
          const body = await callPoseBackend(baseUrl, imagePath)
          return assessExerciseForm(body.keypoints, {
            side: args?.side ?? 'auto',
            expectedPhase: args?.expected_phase ?? null,
            confidenceThreshold,
          })
        },
      }),
    )
  } else {
    ctx.logger?.warn('[linkhealth-vision] tools service unavailable — assess_exercise_form tool not registered')
  }

  // ── 2. Prompt section: tell the model what the tool does and its contract ─
  if (systemPrompt) {
    disposers.push(
      systemPrompt.section({
        name: 'linkhealth-vision',
        order: 250,
        text:
          'LinkHealth Vision provides the `assess_exercise_form` tool for PT/rehab exercise-form checks: it sends one photo ' +
          '(subject standing or seated — never lying down) to the configured vision backend, computes the elbow angle ' +
          'deterministically from the pose keypoints, and reports whether the held position matches the expected phase. ' +
          "The tool's geometry verdict is final — narrate it, never re-judge it. The tool needs the plugin's `baseUrl` " +
          'config set; without it, calling the tool raises a configuration error. Everything here is synthetic/demo ' +
          'data only — never real patient data, and never a clinical decision.',
      }),
    )
  } else {
    ctx.logger?.warn('[linkhealth-vision] systemPrompt service unavailable — prompt section not registered')
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
