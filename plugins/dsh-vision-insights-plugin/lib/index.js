// dsh-vision-insights-plugin — host entry.
//
// The DSH CONSUMER side of the LinkHealth vision-insights architecture:
// OpenVINO edge pipelines (infra/openvino-vision, deployed separately) run
// pose inference + deterministic rules and write structured insight events to
// an insight store; this plugin reads vision services through a `baseUrl`
// config entry and exposes them as DSH tools. LLMs never see images — only
// deterministic, structured results.
//
// Loaded by the Cordis loader as one bundle entry (`name: 'dsh-vision-plugin'`
// in cordis.patch.yml — the package was renamed to dsh-vision-insights-plugin
// on 2026-08-18 to match this architecture; bundle-instance id stays
// `linkhealth-vision`). `apply()` registers the plugin's tools against the
// harness services it finds at boot:
//
//   1. `assess_exercise_form` on `ctx.tools` — sends one photo to the
//      configured vision backend (`/v1/pose`), computes the elbow angle
//      deterministically from the returned keypoints, and reports whether
//      the held position matches the expected exercise phase;
//   2. a system-prompt section describing the tools and their contract.
//
// The photo can come from either source:
//   - `image_path` — a file on disk (relative to the session workspace or
//     absolute), read by the plugin;
//   - no `image_path` — the most recent image the user attached to the
//     conversation, resolved from the session's `user/message` events and read
//     through the `attachments` service. NOTE: this mode only works on a model
//     route that accepts image attachments — the harness's server-side
//     admission gate refuses attached images when the routed model does not
//     declare `image` input (DeepSeek routes are text-only), so the attachment
//     path is dormant until such a route is configured. The tool still
//     registers and the path mode always works.
//
// Design constraints honored here (same as every other plugin in this repo):
//   - No imports from `@deepseek-ai/*` packages: every service is read via
//     `ctx.get(...)` and the tool is registered as a plain descriptor, so the
//     package has zero runtime dependencies.
//   - Deterministic tool decides, LLM only narrates: the geometry rule in
//     `./pose.js` is final, exactly like `dsh-cdi-plugin`'s `cdi_query_rule`.
//   - The vision service is never hardcoded: it is the `baseUrl` config entry
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
export const inject = ['tools', 'systemPrompt', 'attachments']

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

/** Image extension → media type (path mode; attachment refs carry their own). */
const IMAGE_MEDIA_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Resolve a tool-supplied image path against the session workspace. */
function resolveImagePath(exec, imagePath) {
  const base = exec?.agent?.session?.header?.cwd || process.cwd()
  return path.resolve(base, String(imagePath))
}

/** Read a disk image; derive its declared media type from the extension. */
async function readImageFile(imagePath) {
  let bytes
  try {
    bytes = await readFile(imagePath)
  } catch (error) {
    throw new Error(`could not read image file ${imagePath}: ${String(error?.message ?? error)}`)
  }
  const ext = path.extname(imagePath).toLowerCase()
  return {
    bytes,
    mediaType: IMAGE_MEDIA_TYPES[ext] ?? 'image/jpeg',
    filename: path.basename(imagePath),
  }
}

/**
 * Find the most recent image the user attached to the calling session.
 * Scans `user/message` events (newest first) for `image` content blocks and
 * returns the newest attachment ref (`{ attachmentId, mediaType, bytes,
 * width, height, name? }`), or null when none exists.
 */
function latestSessionImageRef(exec) {
  const events = exec?.agent?.session?.events
  if (!Array.isArray(events)) return null
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type !== 'user/message') continue
    const content = event.data?.content ?? event.data?.message?.content
    if (!Array.isArray(content)) continue
    for (let j = content.length - 1; j >= 0; j -= 1) {
      const block = content[j]
      if (block?.type === 'image' && block.attachment?.attachmentId) return block.attachment
    }
  }
  return null
}

function extFromMediaType(mediaType) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
  return map[mediaType] ?? 'jpg'
}

/**
 * POST one image to `<baseUrl>/v1/pose` and return the parsed JSON body.
 * Multipart field name `file` matches infra/openvino-vision/serve.py.
 */
async function postImageToPoseBackend(baseUrl, bytes, { mediaType, filename }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/pose`
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: mediaType }), filename)

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
  const attachments = ctx.get('attachments')

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
          'lying subject). Low-confidence or missing arm keypoints yield insufficient_evidence rather than a guess. ' +
          'The photo is taken from `image_path` when given; otherwise the most recently attached image in the ' +
          'conversation is used (only available on deployments whose model route accepts image attachments).',
        parameters: {
          type: 'object',
          properties: {
            image_path: {
              type: 'string',
              description: 'Optional path to the photo (JPG/PNG), relative to the session workspace or absolute. Omit it to use the most recently attached image in the conversation.',
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
              'assess_exercise_form: vision backend not configured — set the dsh-vision-insights-plugin `baseUrl` config ' +
              '(e.g. http://10.128.0.11:8080 on the LinkHealth VPC)',
            )
          }

          let bytes
          let mediaType
          let filename
          const imagePath = args?.image_path

          if (imagePath && String(imagePath).trim().length > 0) {
            const resolved = resolveImagePath(exec, imagePath)
            const info = await readImageFile(resolved)
            bytes = info.bytes
            mediaType = info.mediaType
            filename = info.filename
          } else {
            if (!attachments) {
              throw new Error(
                'assess_exercise_form: no image_path given and the attachments service is unavailable — ' +
                'pass image_path or deploy with attachments enabled',
              )
            }
            const ref = latestSessionImageRef(exec)
            if (!ref) {
              throw new Error(
                'assess_exercise_form: no image_path given and no image attachment found in the session — ' +
                'attach an image to the conversation or pass image_path',
              )
            }
            const { data } = await attachments.readImage(ref, exec?.signal)
            bytes = new Uint8Array(data)
            mediaType = ref.mediaType ?? 'image/jpeg'
            filename = ref.name ?? `attachment.${extFromMediaType(mediaType)}`
          }

          const body = await postImageToPoseBackend(baseUrl, bytes, { mediaType, filename })
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
          "The tool's geometry verdict is final — narrate it, never re-judge it. Give the photo via `image_path` (a file " +
          'in the workspace) or, on deployments whose model route accepts image attachments, attach the photo to the ' +
          'conversation and call the tool without `image_path`. The tool needs the plugin\'s `baseUrl` config set; without ' +
          'it, calling the tool raises a configuration error. Everything here is synthetic/demo data only — never real ' +
          'patient data, and never a clinical decision.',
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
