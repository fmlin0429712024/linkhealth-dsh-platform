// dsh-vision-plugin — pure pose-geometry helpers and the deterministic
// exercise-form rule.
//
// No imports, no I/O, no DSH services: everything here is a pure function of
// the keypoints returned by the vision backend's `/v1/pose` endpoint, so the
// rule is unit-testable in isolation and the LLM can never re-judge it.
//
// Verified against infra/openvino-vision/pt_test.py's real measurements of a
// bicep-curl clip with human-pose-estimation-0001: a clean rep traced
// extended (~157-160°) -> curled (~36°) -> extended, with confidence staying
// moderate (~0.4) — see infra/openvino-vision/README.md "Use case decision".

/** Deterministic phase band: elbow angle >= this counts as "extended". */
export const EXTENDED_MIN_DEG = 150

/** Deterministic phase band: elbow angle <= this counts as "curled". */
export const CURLED_MAX_DEG = 60

/** Joint triplets per arm side (COCO-style keypoint names, as served). */
export const ARM_JOINTS = {
  left: ['l_shoulder', 'l_elbow', 'l_wrist'],
  right: ['r_shoulder', 'r_elbow', 'r_wrist'],
}

/**
 * Angle at point b formed by a-b-c, in degrees — the same vector formula
 * `infra/openvino-vision/pt_test.py` uses for the elbow angle.
 * @returns {number|null} degrees rounded to 1 decimal, or null when either
 *   arm segment is degenerate (zero length).
 */
export function elbowAngleDeg(a, b, c) {
  const ba = [a.x - b.x, a.y - b.y]
  const bc = [c.x - b.x, c.y - b.y]
  const baLen = Math.hypot(ba[0], ba[1])
  const bcLen = Math.hypot(bc[0], bc[1])
  if (baLen === 0 || bcLen === 0) return null
  const cos = (ba[0] * bc[0] + ba[1] * bc[1]) / (baLen * bcLen)
  const angle = Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI
  return Math.round(angle * 10) / 10
}

/**
 * Deterministic phase classification of a measured elbow angle.
 * @param {number} angleDeg
 * @returns {'extended'|'curled'|'mid_range'}
 */
export function classifyPhase(angleDeg) {
  if (angleDeg >= EXTENDED_MIN_DEG) return 'extended'
  if (angleDeg <= CURLED_MAX_DEG) return 'curled'
  return 'mid_range'
}

/** A keypoint as served: { x, y, confidence }. */
function confident(keypoint, threshold) {
  return keypoint && typeof keypoint.confidence === 'number' && keypoint.confidence >= threshold
    ? keypoint
    : null
}

/** Mean confidence over the three arm joints, rounded to 3 decimals. */
function avgConfidence(joints) {
  const total = joints.reduce((sum, j) => sum + j.confidence, 0)
  return Math.round((total / joints.length) * 1000) / 1000
}

function bandText(phase) {
  return phase === 'extended' ? `>= ${EXTENDED_MIN_DEG}°` : `<= ${CURLED_MAX_DEG}°`
}

/**
 * The deterministic exercise-form rule over `/v1/pose` keypoints.
 *
 * The tool's verdict is FINAL: geometry decides, the LLM only narrates. A
 * single frame can only assess a HELD position, never range of motion across
 * a rep, and the model is only reliable for a standing/seated subject (see
 * infra/openvino-vision/README.md "Known limitation #2").
 *
 * @param {object} keypoints - the `keypoints` field of a /v1/pose response.
 * @param {object} [options]
 * @param {'left'|'right'|'auto'} [options.side='auto'] - which arm to assess;
 *   'auto' picks the side whose three joints are all confidently detected,
 *   preferring the higher average confidence when both qualify.
 * @param {'extended'|'curled'|null} [options.expectedPhase=null] - when set,
 *   the rule also decides whether the measured angle matches the prescribed
 *   held phase (form_ok).
 * @param {number} [options.confidenceThreshold=0.1] - per-joint confidence
 *   floor (matches serve.py's CONF_THRESHOLD and pt_test.py's 0.1).
 * @returns {{
 *   status: 'assessed'|'insufficient_evidence',
 *   side: 'left'|'right'|'none',
 *   elbow_angle_deg: number|null,
 *   avg_confidence: number|null,
 *   phase: 'extended'|'curled'|'mid_range'|null,
 *   expected_phase: 'extended'|'curled'|null,
 *   form_ok: boolean|null,
 *   reason: string,
 * }}
 */
export function assessExerciseForm(keypoints, options = {}) {
  const { side = 'auto', expectedPhase = null, confidenceThreshold = 0.1 } = options
  if (!keypoints || typeof keypoints !== 'object') {
    return {
      status: 'insufficient_evidence', side: 'none',
      elbow_angle_deg: null, avg_confidence: null, phase: null,
      expected_phase: expectedPhase, form_ok: null,
      reason: 'no keypoints returned by the vision backend',
    }
  }

  // Evaluate the requested side(s): each arm needs all three joints present
  // and confidently detected, exactly like pt_test.py's `all(conf >= 0.1)`.
  const evaluate = (sideName) => {
    const names = ARM_JOINTS[sideName]
    const joints = names.map((n) => confident(keypoints[n], confidenceThreshold))
    if (joints.some((j) => j === null)) return null
    return {
      side: sideName,
      joints,
      angle: elbowAngleDeg(joints[0], joints[1], joints[2]),
      avgConf: avgConfidence(joints),
    }
  }

  let arm = null
  if (side === 'left' || side === 'right') {
    arm = evaluate(side)
  } else {
    const left = evaluate('left')
    const right = evaluate('right')
    if (left && right) arm = left.avgConf >= right.avgConf ? left : right
    else arm = left ?? right
  }

  if (!arm) {
    const which = side === 'auto' ? 'neither' : side
    return {
      status: 'insufficient_evidence', side: side === 'auto' ? 'none' : side,
      elbow_angle_deg: null, avg_confidence: null, phase: null,
      expected_phase: expectedPhase, form_ok: null,
      reason:
        `insufficient evidence: ${which} arm keypoints (shoulder/elbow/wrist) not confidently detected — ` +
        `all three must have confidence >= ${confidenceThreshold}`,
    }
  }

  if (arm.angle === null) {
    return {
      status: 'insufficient_evidence', side: arm.side,
      elbow_angle_deg: null, avg_confidence: arm.avgConf, phase: null,
      expected_phase: expectedPhase, form_ok: null,
      reason: 'insufficient evidence: degenerate arm keypoints (shoulder/elbow or elbow/wrist coincide)',
    }
  }

  const phase = classifyPhase(arm.angle)
  let formOk = null
  let expectedNote = ''
  if (expectedPhase === 'extended' || expectedPhase === 'curled') {
    formOk = expectedPhase === 'extended'
      ? arm.angle >= EXTENDED_MIN_DEG
      : arm.angle <= CURLED_MAX_DEG
    expectedNote = formOk
      ? ` — matches expected phase '${expectedPhase}' (${bandText(expectedPhase)})`
      : ` — does NOT match expected phase '${expectedPhase}' (measured ${arm.angle}°, expected ${bandText(expectedPhase)})`
  }

  return {
    status: 'assessed',
    side: arm.side,
    elbow_angle_deg: arm.angle,
    avg_confidence: arm.avgConf,
    phase,
    expected_phase: expectedPhase,
    form_ok: formOk,
    reason:
      `${arm.side} elbow angle ${arm.angle}° — ${phase} phase (${bandText(phase)})` +
      expectedNote,
  }
}
