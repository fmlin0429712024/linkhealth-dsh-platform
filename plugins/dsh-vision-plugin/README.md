# dsh-vision-plugin

**Status: first real tool implemented** — `assess_exercise_form`, a PT/rehab
exercise-form check backed by the deployed OpenVINO pose-estimation service in
[`infra/openvino-vision/`](../../infra/openvino-vision/README.md). The plugin
still does **not** ship a vision model: it talks to one over HTTP through a
`baseUrl` config entry.

## What it does

`assess_exercise_form` sends one photo (JPG/PNG) to the configured vision
backend's `POST /v1/pose`, gets back 18 COCO-style keypoints, and applies a
**deterministic geometric rule** — the elbow angle (shoulder–elbow–wrist) —
exactly the approach `infra/openvino-vision/pt_test.py` verified on a bicep-curl
clip. The tool decides; the LLM only narrates the result (same pattern as
`dsh-cdi-plugin`'s `cdi_query_rule`).

The rule classifies the measured angle into a phase and, when the caller
prescribes an `expected_phase`, decides whether the held position matches:

| Elbow angle | Phase |
| --- | --- |
| `>= 150°` | `extended` |
| `<= 60°` | `curled` |
| otherwise | `mid_range` |

If the required arm keypoints (shoulder/elbow/wrist) are missing or below the
`confidenceThreshold`, the tool returns `insufficient_evidence` rather than a
guess — the confidence score proved a trustworthy filter in the verification.

**Use-case boundaries (from `infra/openvino-vision/README.md` "Use case
decision"):**

- This is **PT/rehab exercise form tracking, not fall detection.** Fall
  detection and lying-position classification were evaluated and rejected:
  `human-pose-estimation-0001`'s confidence collapses on a lying subject (an
  out-of-distribution problem for the model, not a decoder bug). Don't reframe
  this tool as fall risk.
- A single frame assesses a **held position only** — never range of motion
  across a rep (that would need a sequence/video, which is future scope).
- The subject must be **standing or seated**, one person per photo.

Everything here is synthetic/test data only — never real patient data, never a
clinical decision.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | `''` | Base URL of the vision backend (`GET /health`, `POST /v1/pose`). **Required for the tool to work.** |
| `confidenceThreshold` | `0.1` | Per-keypoint confidence floor for the rule; matches the backend's own `CONF_THRESHOLD`. |

Set them via the bundle-instance `config` when wiring the plugin into a DSH
profile (this package's own `cordis.patch.yml` keeps `config: {}` — the
endpoint is a deployment decision).

### Pointing at the running showcase VM

The deployed backend is `linkhealth-openvino-vision` (GCP project
`linkhealth-care-2024`, zone `us-central1-a`, internal IP `10.128.0.11`, port
`8080`). It is reachable **only from inside the VPC** (firewall scoped to
`10.128.0.0/20`, no public inference port), so the plugin must run on a host in
the same VPC/region. With that, set:

```jsonc
// profile patch row config
{ "baseUrl": "http://10.128.0.11:8080" }
```

Smoke-check the backend directly (from inside the VPC):

```sh
curl http://10.128.0.11:8080/health
curl -F "file=@infra/openvino-vision/testdata/pt-exercise-verified/sample-pt-extended.jpg" \
  http://10.128.0.11:8080/v1/pose
```

## Example tool call

```
assess_exercise_form(image_path="infra/openvino-vision/testdata/pt-exercise-verified/sample-pt-curled.jpg",
                     expected_phase="curled", side="right")
→ { status: "assessed", side: "right", elbow_angle_deg: 36, phase: "curled",
    expected_phase: "curled", form_ok: true, reason: "right elbow angle 36° — curled (<= 60°) — matches expected phase 'curled'" }
```

## Design

- **Deterministic tool decides, LLM only narrates** — the geometry rule in
  `lib/pose.js` is final; the tool's description tells the model never to
  re-judge the angle.
- **No hardcoded backend** — the endpoint is the `baseUrl` config value;
  `10.128.0.11` appears only in docs and example config, never in code.
- **No `@deepseek-ai/*` imports, zero runtime dependencies** — services are
  read via `ctx.get(...)`, the tool is a plain descriptor (Node 20 global
  `fetch`/`FormData` for the HTTP call), matching `dsh-triage-plugin`.
- The tool is registered even when `baseUrl` is unset: calling it then raises
  a clear configuration error instead of silently disappearing.

## Development & test

```sh
node --test                                   # unit + integration (HTTP mocked, no VM needed)
node scripts/check-plugin-contract.mjs        # repo contract check (from repo root)
pnpm test                                     # all plugin tests
```

Tests never touch the VM: `test/pose.test.mjs` covers the pure geometry/rule,
`test/assess-exercise-form.test.mjs` covers the tool end-to-end with `fetch`
stubbed (it does read the checked-in `sample-pt-extended.jpg` to assert the
exact bytes are attached), and `test/plugin-contract.test.mjs` pins the Cordis
entry contract.

## Wiring into a deployed profile

Wired into the CI/CD deploy unit (`deploy/profile-linkhealth/cordis.patch.yml`)
with `baseUrl: http://10.128.0.11:8080` — the release build also ships the
synthetic sample frames under `testdata/` (see `.github/workflows/deploy.yml`),
so on the VM the tool can be demoed with e.g.
`/opt/linkhealth/current/testdata/pt-exercise-verified/sample-pt-curled.jpg`
(absolute paths are accepted; if the session sandbox blocks that read, copy the
file into the session workspace first). Deploy flow is the repo's standard
CI/CD: push to `main` → e2e gate (`scripts/e2e-smoke.sh` boots the vision
plugin as a registration guard) → `deploy.yml` builds the release → scp →
`linkhealth-vm2`. The OpenVINO server itself is **not** part of this CI/CD —
it is deployed manually on its own VM (see `infra/openvino-vision/README.md`).

### Testing locally through a tunnel

The vision backend is VPC-internal, so from a laptop, tunnel to it first:

```sh
gcloud compute ssh linkhealth-openvino-vision \
  --project linkhealth-care-2024 --zone us-central1-a \
  --tunnel-through-iap -- -N -L 8080:localhost:8080
```

Then run the plugin's tool end-to-end against the real backend (no DSH profile
needed):

```sh
node scripts/smoke-vision-tool.mjs http://127.0.0.1:8080
```

It drives `assess_exercise_form` over the two checked-in sample frames and
exits 0 only if both are assessed with the expected phases.

To experience the deployed profile on the VM (after a CI/CD deploy), tunnel to
the DSH web UI instead:

```sh
gcloud compute ssh linkhealth-vm2 -- -L 3084:localhost:3080
# open http://127.0.0.1:3084 and ask the model to run assess_exercise_form
# on /opt/linkhealth/current/testdata/pt-exercise-verified/sample-pt-*.jpg
```
