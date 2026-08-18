// smoke-vision-tool.mjs — local end-to-end smoke of the assess_exercise_form
// tool against a REAL vision backend (no DSH profile needed).
//
// Use it with an IAP/SSH tunnel to the OpenVINO showcase VM, e.g.:
//
//   gcloud compute ssh linkhealth-openvino-vision \
//     --project linkhealth-care-2024 --zone us-central1-a \
//     --tunnel-through-iap -- -N -L 8080:localhost:8080
//   node scripts/smoke-vision-tool.mjs http://127.0.0.1:8080
//
// Defaults to http://127.0.0.1:8080 (env VISION_BASE_URL overrides).
// Zero dependencies: loads the plugin's apply() with a fake ctx, grabs the
// registered tool descriptor, and runs execute() against the live backend
// using the checked-in synthetic sample frames.
//
// Exit code 0 only when both samples are assessed and match their expected
// phases. See plugins/dsh-vision-plugin/README.md.

import { apply } from '../plugins/dsh-vision-plugin/lib/index.js'

const REPO_ROOT = new URL('..', import.meta.url).pathname
const baseUrl = process.argv[2] ?? process.env.VISION_BASE_URL ?? 'http://127.0.0.1:8080'

const tool = (() => {
  let captured = null
  const ctx = {
    get: (svc) => {
      if (svc === 'tools') {
        return { register: (definition) => ((captured = definition), () => {}) }
      }
      if (svc === 'systemPrompt') return { section: () => () => {} }
      return undefined
    },
    logger: { warn() {}, info() {} },
  }
  apply(ctx, { baseUrl })
  if (!captured) throw new Error('assess_exercise_form tool was not registered')
  return captured
})()

const exec = { agent: { session: { header: { cwd: REPO_ROOT } } } }

const cases = [
  {
    label: 'sample-pt-extended (verified ~157°)',
    image_path: 'infra/openvino-vision/testdata/pt-exercise-verified/sample-pt-extended.jpg',
    expected_phase: 'extended',
  },
  {
    label: 'sample-pt-curled (verified ~36°)',
    image_path: 'infra/openvino-vision/testdata/pt-exercise-verified/sample-pt-curled.jpg',
    expected_phase: 'curled',
  },
  {
    label: 'mismatch check (curled image, expected extended)',
    image_path: 'infra/openvino-vision/testdata/pt-exercise-verified/sample-pt-curled.jpg',
    expected_phase: 'extended',
  },
]

let failed = 0
console.log(`==> assess_exercise_form smoke against ${baseUrl}\n`)

for (const c of cases) {
  const result = await tool.execute({ image_path: c.image_path, expected_phase: c.expected_phase }, exec)
  const [text] = tool.output.render({}, result)
  console.log(`--- ${c.label}`)
  console.log(text.text)
  console.log(`    raw: ${JSON.stringify(result)}\n`)
  if (result.status !== 'assessed') failed = 1
  if (c.expected_phase === 'extended' && c.image_path.includes('curled') && result.form_ok !== false) failed = 1
}

if (failed) {
  console.error('SMOKE FAILED')
  process.exit(1)
}
console.log('SMOKE OK — tool works against the live backend')
