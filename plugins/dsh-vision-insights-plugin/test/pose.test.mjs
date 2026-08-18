// Unit tests for lib/pose.js — pure geometry and the deterministic
// exercise-form rule. Zero dependencies, no HTTP, no DSH services.
// Run: node --test  (from the package root)

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ARM_JOINTS,
  EXTENDED_MIN_DEG,
  CURLED_MAX_DEG,
  elbowAngleDeg,
  classifyPhase,
  assessExerciseForm,
} from '../lib/pose.js'

/** Build a keypoints object from per-side joint points + confidences. */
function keypointsOf({ shoulder, elbow, wrist, side = 'right', confidence = 0.3 }) {
  const prefix = side === 'left' ? 'l' : 'r'
  return {
    [`${prefix}_shoulder`]: { ...shoulder, confidence },
    [`${prefix}_elbow`]: { ...elbow, confidence },
    [`${prefix}_wrist`]: { ...wrist, confidence },
  }
}

test('elbowAngleDeg computes the angle at the elbow joint', () => {
  // Straight arm: 180°.
  assert.equal(elbowAngleDeg({ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 200 }), 180)
  // Right angle: 90°.
  assert.equal(elbowAngleDeg({ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }), 90)
  // Curled (forearm folded back toward the shoulder): ~6.3°.
  const curled = elbowAngleDeg({ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 10, y: 10 })
  assert.ok(curled > 5 && curled < 8, `expected a small curled angle, got ${curled}`)
  // Order matters: angle is at the middle point.
  const mirrored = elbowAngleDeg({ x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 })
  assert.equal(mirrored, 90)
})

test('elbowAngleDeg returns null for degenerate (zero-length) segments', () => {
  assert.equal(elbowAngleDeg({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 }), null)
  assert.equal(elbowAngleDeg({ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 100 }), null)
})

test('classifyPhase uses the verified bands', () => {
  assert.equal(classifyPhase(180), 'extended')
  assert.equal(classifyPhase(EXTENDED_MIN_DEG), 'extended') // boundary
  assert.equal(classifyPhase(157.2), 'extended') // verified extended frame
  assert.equal(classifyPhase(100), 'mid_range')
  assert.equal(classifyPhase(66.6), 'mid_range') // verified mid frame
  assert.equal(classifyPhase(CURLED_MAX_DEG), 'curled') // boundary
  assert.equal(classifyPhase(35.7), 'curled') // verified curled frame
})

test('assessExerciseForm: assessed extended right arm with expected phase', () => {
  const kp = keypointsOf({
    shoulder: { x: 0, y: 0 },
    elbow: { x: 0, y: 100 },
    wrist: { x: 0, y: 200 },
    confidence: 0.4,
  })
  const result = assessExerciseForm(kp, { expectedPhase: 'extended' })
  assert.equal(result.status, 'assessed')
  assert.equal(result.side, 'right')
  assert.equal(result.elbow_angle_deg, 180)
  assert.equal(result.phase, 'extended')
  assert.equal(result.avg_confidence, 0.4)
  assert.equal(result.expected_phase, 'extended')
  assert.equal(result.form_ok, true)
  assert.match(result.reason, /matches expected phase 'extended'/)
})

test('assessExerciseForm: curled left arm, expected curled passes', () => {
  const kp = keypointsOf({
    side: 'left',
    shoulder: { x: 0, y: 0 },
    elbow: { x: 0, y: 100 },
    wrist: { x: 10, y: 10 }, // folded back toward the shoulder
    confidence: 0.3,
  })
  const result = assessExerciseForm(kp, { side: 'left', expectedPhase: 'curled' })
  assert.equal(result.status, 'assessed')
  assert.equal(result.side, 'left')
  assert.equal(result.phase, 'curled')
  assert.equal(result.form_ok, true)
})

test('assessExerciseForm: measured phase mismatching the expected one fails', () => {
  const kp = keypointsOf({
    shoulder: { x: 0, y: 0 },
    elbow: { x: 0, y: 100 },
    wrist: { x: 0, y: 200 }, // extended arm
    confidence: 0.4,
  })
  const result = assessExerciseForm(kp, { expectedPhase: 'curled' })
  assert.equal(result.status, 'assessed')
  assert.equal(result.form_ok, false)
  assert.match(result.reason, /does NOT match expected phase 'curled'/)
})

test('assessExerciseForm: without expected_phase it reports measurement only', () => {
  const kp = keypointsOf({
    shoulder: { x: 0, y: 0 },
    elbow: { x: 0, y: 100 },
    wrist: { x: 100, y: 100 },
    confidence: 0.25,
  })
  const result = assessExerciseForm(kp)
  assert.equal(result.status, 'assessed')
  assert.equal(result.elbow_angle_deg, 90)
  assert.equal(result.phase, 'mid_range')
  assert.equal(result.expected_phase, null)
  assert.equal(result.form_ok, null)
})

test('assessExerciseForm: low-confidence joints yield insufficient_evidence', () => {
  const kp = keypointsOf({
    shoulder: { x: 0, y: 0 },
    elbow: { x: 0, y: 100 },
    wrist: { x: 0, y: 200 },
    confidence: 0.05, // below the default 0.1 floor
  })
  const result = assessExerciseForm(kp)
  assert.equal(result.status, 'insufficient_evidence')
  assert.equal(result.side, 'none')
  assert.equal(result.elbow_angle_deg, null)
  assert.equal(result.phase, null)
  assert.match(result.reason, /not confidently detected/)
})

test('assessExerciseForm: missing joints yield insufficient_evidence', () => {
  const result = assessExerciseForm({ nose: { x: 0, y: 0, confidence: 0.9 } })
  assert.equal(result.status, 'insufficient_evidence')
  assert.match(result.reason, /insufficient evidence/)
})

test('assessExerciseForm: degenerate keypoints yield insufficient_evidence, not NaN', () => {
  const kp = keypointsOf({
    shoulder: { x: 0, y: 0 },
    elbow: { x: 0, y: 0 }, // coincides with shoulder
    wrist: { x: 0, y: 100 },
    confidence: 0.5,
  })
  const result = assessExerciseForm(kp)
  assert.equal(result.status, 'insufficient_evidence')
  assert.match(result.reason, /degenerate/)
})

test('assessExerciseForm: explicit side is authoritative', () => {
  // Only the LEFT arm is confidently detected.
  const kp = {
    ...keypointsOf({ side: 'left', shoulder: { x: 0, y: 0 }, elbow: { x: 0, y: 100 }, wrist: { x: 0, y: 200 }, confidence: 0.4 }),
    r_shoulder: { x: 0, y: 0, confidence: 0.05 },
    r_elbow: { x: 0, y: 100, confidence: 0.05 },
    r_wrist: { x: 0, y: 200, confidence: 0.05 },
  }
  // Asking for the right side must not silently fall back to the left.
  const wrongSide = assessExerciseForm(kp, { side: 'right' })
  assert.equal(wrongSide.status, 'insufficient_evidence')
  assert.equal(wrongSide.side, 'right')
  // Auto picks the only confidently detected arm.
  const auto = assessExerciseForm(kp)
  assert.equal(auto.status, 'assessed')
  assert.equal(auto.side, 'left')
})

test('assessExerciseForm: auto prefers the higher-confidence arm when both qualify', () => {
  const kp = {
    ...keypointsOf({ side: 'left', shoulder: { x: 0, y: 0 }, elbow: { x: 0, y: 100 }, wrist: { x: 0, y: 200 }, confidence: 0.2 }),
    ...keypointsOf({ side: 'right', shoulder: { x: 0, y: 0 }, elbow: { x: 0, y: 100 }, wrist: { x: 0, y: 200 }, confidence: 0.5 }),
  }
  const result = assessExerciseForm(kp)
  assert.equal(result.status, 'assessed')
  assert.equal(result.side, 'right')
  assert.equal(result.avg_confidence, 0.5)
})

test('assessExerciseForm: non-object keypoints yield insufficient_evidence', () => {
  assert.equal(assessExerciseForm(null).status, 'insufficient_evidence')
  assert.equal(assessExerciseForm(undefined).status, 'insufficient_evidence')
  assert.equal(assessExerciseForm('nope').status, 'insufficient_evidence')
})

test('ARM_JOINTS covers both sides with three joints each', () => {
  assert.deepEqual(ARM_JOINTS.left, ['l_shoulder', 'l_elbow', 'l_wrist'])
  assert.deepEqual(ARM_JOINTS.right, ['r_shoulder', 'r_elbow', 'r_wrist'])
})
