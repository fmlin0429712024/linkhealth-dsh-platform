// Integration tests for the assess_exercise_form tool: apply() wiring, the
// multipart HTTP call (global fetch stubbed — no live dependency on the
// vision VM), and error paths. Zero dependencies beyond node:test.
// Run: node --test  (from the package root)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { apply, name, inject } from '../lib/index.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** A vision-backend keypoints object for a confidently detected extended right arm. */
const EXTENDED_RIGHT_ARM_PAYLOAD = {
  model: 'human-pose-estimation-0001',
  image_size: { width: 640, height: 480 },
  keypoints: {
    nose: { x: 100, y: 50, confidence: 0.6 },
    neck: { x: 100, y: 80, confidence: 0.5 },
    r_shoulder: { x: 100, y: 100, confidence: 0.4 },
    r_elbow: { x: 100, y: 200, confidence: 0.4 },
    r_wrist: { x: 100, y: 300, confidence: 0.4 },
    l_shoulder: { x: 100, y: 100, confidence: 0.05 },
    l_elbow: { x: 100, y: 200, confidence: 0.05 },
    l_wrist: { x: 100, y: 300, confidence: 0.05 },
    r_hip: { x: 100, y: 320, confidence: 0.4 },
    l_hip: { x: 100, y: 320, confidence: 0.4 },
  },
  assessment: { flag: 'upright', risk_level: 'Low', reason: 'torso angle 0.0 deg from vertical' },
}

/** A checked-in synthetic photo, used as the tool's file input in tests. */
const SAMPLE_IMAGE = 'infra/openvino-vision/testdata/pt-exercise-verified/sample-pt-extended.jpg'

/** Capture apply()'s registrations through fake services. */
function applyWithServices(entryConfig) {
  const registered = { tools: [], sections: [], disposed: [] }
  const ctx = {
    get: (svc) => {
      if (svc === 'tools') {
        return {
          register: (definition) => {
            registered.tools.push(definition)
            return () => registered.disposed.push(`tool:${definition.name}`)
          },
        }
      }
      if (svc === 'systemPrompt') {
        return {
          section: (section) => {
            registered.sections.push(section)
            return () => registered.disposed.push(`section:${section.name}`)
          },
        }
      }
      return undefined
    },
    logger: { warn() {}, info() {} },
  }
  const dispose = apply(ctx, entryConfig)
  return { registered, dispose }
}

/** Stub globalThis.fetch for one test; restores afterwards. */
function withFetchStub(t, handler) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => handler(url, init)
  t.after(() => {
    globalThis.fetch = original
  })
}

const sessionExec = (cwd = REPO_ROOT) => ({ agent: { session: { header: { cwd } } } })

test('apply() registers the assess_exercise_form tool and one prompt section', () => {
  const { registered, dispose } = applyWithServices({ baseUrl: 'http://backend.test:8080' })
  assert.equal(registered.tools.length, 1)
  assert.equal(registered.tools[0].name, 'assess_exercise_form')
  assert.equal(registered.sections.length, 1)
  assert.equal(registered.sections[0].name, name)
  assert.ok(Array.isArray(inject) && inject.includes('tools'))
  dispose()
  assert.equal(registered.disposed.length, 2)
})

test('execute posts the image as multipart to <baseUrl>/v1/pose and returns the assessment', async (t) => {
  const { registered } = applyWithServices({ baseUrl: 'http://backend.test:8080/' }) // trailing slash
  const tool = registered.tools[0]

  let seenUrl = null
  let seenInit = null
  withFetchStub(t, async (url, init) => {
    seenUrl = url
    seenInit = init
    return { ok: true, json: async () => EXTENDED_RIGHT_ARM_PAYLOAD }
  })

  const result = await tool.execute(
    { image_path: SAMPLE_IMAGE },
    sessionExec(),
  )

  assert.equal(seenUrl, 'http://backend.test:8080/v1/pose') // baseUrl is config, trailing slash normalized
  assert.equal(seenInit.method, 'POST')
  assert.ok(seenInit.body instanceof FormData, 'body must be multipart FormData')
  const filePart = seenInit.body.get('file')
  assert.ok(filePart, 'multipart field must be named "file" (serve.py contract)')
  const expectedBytes = readFileSync(`${REPO_ROOT}/${SAMPLE_IMAGE}`)
  const sentBytes = Buffer.from(await filePart.arrayBuffer())
  assert.deepEqual(sentBytes, expectedBytes, 'the exact image bytes must be sent')

  assert.equal(result.status, 'assessed')
  assert.equal(result.side, 'right')
  assert.equal(result.elbow_angle_deg, 180)
  assert.equal(result.phase, 'extended')
  assert.equal(result.avg_confidence, 0.4)
  assert.match(result.reason, /right elbow angle 180° — extended/)
})

test('execute applies expected_phase and side arguments', async (t) => {
  const { registered } = applyWithServices({ baseUrl: 'http://backend.test:8080' })
  const tool = registered.tools[0]
  withFetchStub(t, async () => ({ ok: true, json: async () => EXTENDED_RIGHT_ARM_PAYLOAD }))

  const mismatch = await tool.execute(
    { image_path: SAMPLE_IMAGE, expected_phase: 'curled' },
    sessionExec(),
  )
  assert.equal(mismatch.form_ok, false)
  assert.equal(mismatch.expected_phase, 'curled')
  assert.match(mismatch.reason, /does NOT match expected phase 'curled'/)

  // Requesting the left side, which is low-confidence in the fixture.
  const wrongSide = await tool.execute(
    { image_path: SAMPLE_IMAGE, side: 'left' },
    sessionExec(),
  )
  assert.equal(wrongSide.status, 'insufficient_evidence')
  assert.equal(wrongSide.side, 'left')
})

test('execute honors the configured confidenceThreshold', async (t) => {
  const { registered } = applyWithServices({
    baseUrl: 'http://backend.test:8080',
    confidenceThreshold: 0.5, // fixture confidence is 0.4 — must fail now
  })
  const tool = registered.tools[0]
  withFetchStub(t, async () => ({ ok: true, json: async () => EXTENDED_RIGHT_ARM_PAYLOAD }))

  const result = await tool.execute({ image_path: SAMPLE_IMAGE }, sessionExec())
  assert.equal(result.status, 'insufficient_evidence')
  assert.match(result.reason, /confidence >= 0.5/)
})

test('execute without a configured baseUrl fails loudly', async (t) => {
  const { registered } = applyWithServices({})
  const tool = registered.tools[0]
  withFetchStub(t, async () => {
    throw new Error('fetch must not be called without a baseUrl')
  })
  await assert.rejects(
    tool.execute({ image_path: SAMPLE_IMAGE }, sessionExec()),
    /baseUrl/,
  )
})

test('execute surfaces a non-2xx backend response', async (t) => {
  const { registered } = applyWithServices({ baseUrl: 'http://backend.test:8080' })
  const tool = registered.tools[0]
  withFetchStub(t, async () => ({ ok: false, status: 500, text: async () => 'internal error' }))
  await assert.rejects(
    tool.execute({ image_path: SAMPLE_IMAGE }, sessionExec()),
    /HTTP 500: internal error/,
  )
})

test('execute surfaces non-JSON and keypoint-less backend responses', async (t) => {
  const { registered } = applyWithServices({ baseUrl: 'http://backend.test:8080' })
  const tool = registered.tools[0]

  withFetchStub(t, async () => ({
    ok: true,
    json: async () => { throw new Error('not json') },
  }))
  await assert.rejects(tool.execute({ image_path: SAMPLE_IMAGE }, sessionExec()), /non-JSON/)

  withFetchStub(t, async () => ({ ok: true, json: async () => ({ model: 'x' }) }))
  await assert.rejects(tool.execute({ image_path: SAMPLE_IMAGE }, sessionExec()), /missing the keypoints field/)
})

test('execute fails clearly when the image file cannot be read', async (t) => {
  const { registered } = applyWithServices({ baseUrl: 'http://backend.test:8080' })
  const tool = registered.tools[0]
  withFetchStub(t, async () => {
    throw new Error('fetch must not be called for an unreadable image')
  })
  await assert.rejects(
    tool.execute({ image_path: 'definitely/not/a/real/image.jpg' }, sessionExec()),
    /could not read image file/,
  )
})

test('execute resolves image_path against the session workspace cwd', async (t) => {
  const { registered } = applyWithServices({ baseUrl: 'http://backend.test:8080' })
  const tool = registered.tools[0]
  let sentFileSize = null
  withFetchStub(t, async (_url, init) => {
    sentFileSize = (await init.body.get('file').arrayBuffer()).byteLength
    return { ok: true, json: async () => EXTENDED_RIGHT_ARM_PAYLOAD }
  })
  // Relative path, cwd = repo root — exercises the exec.cwd resolution path.
  await tool.execute({ image_path: SAMPLE_IMAGE }, sessionExec())
  assert.equal(sentFileSize, readFileSync(`${REPO_ROOT}/${SAMPLE_IMAGE}`).length)
})
