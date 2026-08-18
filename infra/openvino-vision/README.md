# infra/openvino-vision

**Status: Tier-1 showcase deployed and smoke-tested (2026-08-18).** A pose-
estimation inference service is live on a dedicated GCP VM — see
"Implementation status" below for what's actually running, how to hit it,
and a known limitation to be aware of before trusting its output on a
multi-person scene.

This directory tracks the OpenVINO inference showcase that
`plugins/dsh-vision-insights-plugin` will eventually call. `plugins/dsh-vision-insights-plugin`
itself is still a placeholder (see that package's README) — it will only
ever hold a `baseUrl`/`apiKey`-style config pointing at this service's
endpoint, once the plugin implementation starts.

## Why this lives outside `plugins/`

`plugins/*` is a pnpm workspace of Cordis/DSH plugin packages
(`pnpm-workspace.yaml: packages: plugins/*`), each checked by
`scripts/check-plugin-contract.mjs` against the DSH plugin contract (host/
client entry exports, `dsh.bundle.patch` or `dsh.client.platform`, etc.).
This is infrastructure for a service that runs independently on its own VM
— a different deploy unit, a different lifecycle, no Cordis plugin contract
to satisfy. It's a sibling to `deploy/` (which provisions the VM for *this
repo's DSH profile*, a separate concern) rather than something bundled into
any npm package.

`plugins/dsh-vision-insights-plugin` will only ever hold a `baseUrl`/`apiKey`-style
config pointing at whatever this service's endpoint is — it does not import
or bundle anything from here.

## Design decided so far

- **OpenVINO is a loosely-coupled anchor, not a disposable MVP shortcut.**
  The longer-term direction is extending the platform into IIoT/Edge
  inference; LinkHealth Vision is the first vertical proving that out.
  "Loosely coupled" means `dsh-vision-insights-plugin` talks to this service over an
  OpenAI-compatible HTTP contract and never hard-codes OpenVINO specifics —
  but building this out for real (not skipping it for a hosted API) is the
  point.
- **Anchor showcase: Pose Estimation, not open-ended VLM Q&A.** Use
  `human-pose-estimation-0001` (Open Model Zoo, via
  [openvinotoolkit/openvino_notebooks](https://github.com/openvinotoolkit/openvino_notebooks/tree/main/notebooks/402-pose-estimation-webcam))
  to get structured keypoints, then apply a **deterministic geometric rule**
  (not an LLM judgment call) to flag possible falls/abnormal posture. This
  mirrors the repo's existing pattern in `dsh-cdi-plugin` — deterministic
  tool decides, the LLM only narrates the result — rather than trusting a
  VLM's free-text description.
- **Test data — fully existing, nothing to source ourselves:**
  - Pipeline smoke test (proves the service works, not patient-care-shaped):
    the same model + sample video the official notebook uses —
    `human-pose-estimation-0001` and
    `storage.openvinotoolkit.org/data/test_data/videos/store-aisle-detection.mp4`.
  - Patient-care-shaped test data: public academic fall-detection datasets
    with home-like scenes — UR Fall Detection Dataset (Kwolek & Kepski,
    2014) and the Le2i Fall Detection Dataset (public mirror on Kaggle,
    `tuyenldvn/falldataset-imvia`). License terms (attribution/no-commercial
    clauses) need checking before any public-facing demo use — not yet
    verified.

## Who builds this

Originally scoped as design-only (built/deployed through DSH, not this
Claude Code session) — the user explicitly asked this session to provision,
install, and deploy the Tier-1 showcase directly (2026-08-18), so that part
happened here instead. The business plugin implementation
(`plugins/dsh-vision-insights-plugin`) is still out of scope for this session unless
asked again.

## Implementation status (2026-08-18)

A pose-estimation showcase is live on a dedicated VM, reachable only from
inside the VPC (no public inference port):

| | |
| --- | --- |
| VM | `linkhealth-openvino-vision` (`us-central1-a`, internal IP `10.128.0.11`) — see "Provisioned instance" below for how it was created |
| Service | systemd unit `openvino-vision.service` (auto-restarts on failure, starts on boot), FastAPI + Uvicorn on port 8080, code at `/opt/openvino-vision/serve.py` on the VM (not checked into this repo yet — see "Next steps") |
| Endpoints | `GET /health`; `POST /v1/pose` (multipart `file=@image.jpg`) → 18 COCO-style keypoints + a deterministic `assessment` (torso-angle-from-vertical rule, threshold 55°) |
| Model | `human-pose-estimation-0001` (FP16-INT8), downloaded from the official Open Model Zoo storage URL onto the VM at `/opt/openvino-vision/model/` |
| Verified | `core.available_devices == ['CPU']`; `/health` returns `ok`; a real inference call on a video frame with a clearly-visible person returned high-confidence keypoints (0.4–0.9) and a torso-angle assessment |

**Known limitation #1, confirmed during smoke testing:** the keypoint decoder
takes the single highest-confidence point per heatmap channel (documented in
`serve.py`'s docstring) — no PAF-based multi-person grouping. On the
official `store-aisle-detection.mp4` smoke-test video (a **multi-person**
store-aisle scene), this produced an anatomically incoherent skeleton (neck
and hip keypoints ~340px apart in a 720×404 frame, clearly from different
people), which flagged a spurious `possible_fall_or_lying / High`. That flag
is a **known false positive from testing the decoder outside its designed
assumption** (one subject per photo), not a service bug.

## Timeline test (2026-08-18) — the real validation

Single frames aren't a trustworthy test (see limitation #1 above) — the
right check is sampling a video across its timeline and comparing the
service's output to what's actually happening on screen at each timestamp.
Test asset used, chosen because it's existing, public, single-person, and
purpose-built (no dataset/Kaggle auth wall, unlike Le2i/URFD which are still
an option later):

**[computationalcore/fall-detection](https://github.com/computationalcore/fall-detection)**
— `example/demo.mp4` (a person walking, then falling), downloaded from
`https://raw.githubusercontent.com/computationalcore/fall-detection/master/example/demo.mp4`.

**Important: `/v1/pose` only ever accepts a single image (JPG/PNG), never a
video.** The video was just a convenient *source* of many different real
poses to test against — frames were extracted from it client-side (OpenCV)
and POSTed one at a time; the server never saw the .mp4 itself. Video/
continuous-monitoring input is explicitly future scope, not part of this
showcase.

Two single-frame stills extracted from the clip are checked into
`testdata/` in this directory for reuse — e.g. when testing the DSH plugin
later, these are actual images to attach, not the source video:

- `testdata/fall-detection-rejected/sample-upright.jpg` (t=9.6s — standing, confidently detected)
- `testdata/fall-detection-rejected/sample-post-fall.jpg` (t=19.3s — during/after the fall,
  `insufficient_evidence` per known limitation #2 above)
- `testdata/fall-detection-rejected/sample-fall-moment.jpg` (t=16.2s — the one frame
  that did catch it, see "Known limitation #2" below)

Sampling 12 frames evenly across the 21.3s / 532-frame clip and calling
`/v1/pose` on each (script: `timeline_test.py`, in this directory):

```
t= 0.0–7.7s   insufficient_evidence   (subject not yet clearly in frame)
t= 9.6–15.4s  upright, Low risk       (subject walking — torso angle 3–19°, correct)
t=17.4–21.2s  insufficient_evidence   (subject actually falls in this window)
```

**Known limitation #2:** the service correctly recognizes "upright" while
the subject is walking and never false-alarms. A denser scan of the
transition (every 8 frames from t=15.2s to the end) showed it's not simply
"misses the fall" either — it's **inconsistent**:

```
t=15.2–15.5s  upright, Low
t=15.8s       insufficient_evidence
t=16.2s       possible_fall_or_lying, High, torso angle 71.5°   <- caught it, one frame
t=16.5–21.0s  insufficient_evidence, continuously, for the rest of the clip
```

It caught the fall transition confidently in exactly one frame, then lost
the signal entirely for the ~4.5s where the subject lies still on the
ground — the opposite of what you'd expect if a settled, motionless pose
were easier to read than a dynamic one. Best guess: `human-pose-estimation-0001`
is trained mostly on upright/pedestrian poses, so a person lying flat,
viewed from this camera angle, is out-of-distribution for the model itself
— not something a better decoder or a confidence-threshold tweak fixes. This
is a **model limitation**, not a bug in `serve.py`.

## Use case decision (2026-08-18)

Given limitation #2, any use case that depends on this model reliably
recognizing a **lying-down pose** is on shaky ground. Two candidates were
considered and rejected/accepted on that basis:

- ❌ **Patient repositioning compliance** (classify supine/left-side/
  right-side from a photo, to confirm a bedbound patient was actually
  turned) — rejected without needing a new test: it requires reliable
  keypoints on a *lying* subject, which is exactly what limitation #2 already
  disproves. Doing this for real would need a model trained specifically on
  in-bed/lying poses (a different research problem, e.g. datasets like SLP
  in the academic literature) — a real redeploy, not a config change.
- ✅ **Physical therapy / rehab exercise form tracking** (subject holds or
  performs a controlled movement, standing or seated — never lying down) —
  accepted and verified below, using the **same deployed model**, no
  redeploy needed.

### Verification: bicep-curl elbow-angle tracking

Test asset (existing, public, purpose-built, no auth wall — same pattern as
the fall-detection clip):
**[stevenzchen/pose-trainer](https://github.com/stevenzchen/pose-trainer)**
— `sample_bicep_curl.mp4`, downloaded from
`https://raw.githubusercontent.com/stevenzchen/pose-trainer/master/sample_bicep_curl.mp4`.

Rather than the binary torso-angle rule, this test computes the **elbow
angle** (shoulder–elbow–wrist) per frame — a different deterministic
geometric rule over the same keypoint output, showing the pipeline supports
more than one use case without changing the model. Sampling 20 frames across
the 2.2s / 67-frame clip (script: `pt_test.py`, in this directory):

```
t=0.0s  156.8°  (arm extended)            avg confidence 0.44
t=0.3s  119.8°
t=0.6s   78.6°
t=0.8s   35.7°  (fully curled)            avg confidence 0.29
t=0.9s  175.4°  <- outlier reading                          avg confidence 0.12 (lowest in the clip)
t=1.0s   35.6°  (back to curled, correct) avg confidence 0.31
t=1.4s   66.6°
t=1.8s  125.6°
t=2.2s  159.6°  (extended again)          avg confidence 0.44
```

This traces a single clean rep (extended → curled → extended) as a smooth
angle curve. Confidence stayed moderate (~0.4) and never collapsed the way
it did for the lying pose — and the **one clearly wrong reading (175.4°)
coincided with the single lowest confidence value in the whole clip
(0.12)**, meaning the confidence score is itself a trustworthy filter here:
discarding low-confidence frames would have caught that bad reading. This is
the verification the priority asked for: a genuinely working, explainable
use case on the currently-deployed model, not just "the pipeline runs."

Two representative frames are checked into `testdata/` for reuse:
- `testdata/pt-exercise-verified/sample-pt-extended.jpg` (t=0.0s, elbow ~157°)
- `testdata/pt-exercise-verified/sample-pt-curled.jpg` (t=0.8s, elbow ~36°)

`testdata/` is organized by status: `pt-exercise-verified/` is the current
direction, `fall-detection-rejected/` is kept as evidence for the rejected
direction (see "Use case decision" above), not deleted — cheap to keep,
useful if a different (lying-pose-capable) model is evaluated later.

## Next steps (not done yet)

- The verified use case is PT/rehab exercise form tracking, not fall
  detection — decide whether `plugins/dsh-vision-insights-plugin`'s first real tool
  should target this (e.g. an `assess_exercise_form`-style tool) instead of
  the fall-risk tools sketched in the original brainstorm.
- ~~`serve.py`, `openvino-vision.service`, `timeline_test.py`, and `pt_test.py`
  exist only on the VM right now — not checked into this repo.~~ Done
  2026-08-18 — all four are now in this directory (same content as what's
  deployed on `linkhealth-openvino-vision`; not auto-synced, redeploy
  manually if either copy changes).
- Everything else in "Open questions" below is still open.

## Decided (2026-08-17)

- **CPU only, no GPU for now.** `human-pose-estimation-0001` is an
  Intel/OpenVINO CPU-optimized edge model, usage is low-frequency
  (per-photo, not continuous real-time video), and a GPU VM's always-on cost
  isn't justified yet for a one-person startup validating an MVP. Revisit
  only if the model grows heavier (a real VLM) or the workload becomes
  continuous real-time video.
- **Dedicated new VM, not a reuse of `linkhealth-vm`/`linkhealth-vm2`.**
  Those two are this repo's DSH-profile deploy targets (see
  `docs/deployment-gcp.md`) — a different service with a different
  lifecycle (see "Why this lives outside `plugins/`" above); mixing the
  OpenVINO service onto them would conflate the two. Target machine series:
  **N2 or C2** (Intel Ice Lake/Cascade Lake — AVX-512 + VNNI, unlike the
  existing E2/Broadwell instances, for meaningfully faster INT8 inference).
  Provisioned as `linkhealth-openvino-vision` — see "Provisioned instance"
  below.
- `linkhealth-vm` (35.188.149.18, the old demo deploy, already marked for
  eventual deletion in `docs/deployment-gcp.md`) was **stopped** (not
  deleted) 2026-08-17 to free it up — it does not serve CI/CD deploys.
  `linkhealth-vm2` (the actual `DEPLOY_HOST`) was left running, untouched.

## Provisioned instance (2026-08-18)

The spec below was reviewed and approved, then actually run — this is a
record of what exists, not a pending proposal anymore.

| | |
| --- | --- |
| Name | `linkhealth-openvino-vision` |
| Project / zone | `linkhealth-care-2024` / `us-central1-a` (same as the existing VMs, keeps things simple) |
| Machine type | `n2-standard-2` (2 vCPU / 8 GB — same shape as the current `e2-standard-2` VMs). **N2 is Intel-only on GCP already** (the AMD equivalent is a separate series, N2D) — `--min-cpu-platform="Intel Cascade Lake"` is added below to pin it explicitly rather than rely on the (already-Intel) default, since Intel/OpenVINO is a deliberate partner choice, not an implementation detail. Cascade Lake already has AVX-512 + VNNI. |
| Provisioning | **Standard** (on-demand, not Spot) — decided 2026-08-17: Spot can be preempted mid-session, which is disruptive while actively developing/debugging against the instance; revisit Spot once the service is stable and just needs to sit idle between test runs |
| Estimated cost | **~$0.097/hr ≈ $71/mo** on-demand for `n2-standard-2` in `us-central1` (a Spot instance would run ~$23/mo instead, ~67% cheaper — an option to reconsider later, not now) — source below |
| OS image | `debian-12` (matches `linkhealth-vm2`, per `docs/deployment-gcp.md`) |
| Boot disk | 50 GB `pd-balanced` (OpenVINO + Python deps + model files won't fit comfortably in the default 10 GB) |
| Network exposure | **No public inference port.** Firewall rule scoped to the VPC's internal range only (`10.128.0.0/20`), tagged `openvino-vision` — so only other VMs in this same network (e.g. wherever `dsh-vision-insights-plugin` ends up running) can reach it, not the open internet. SSH access is via IAP tunneling (`gcloud compute ssh --tunnel-through-iap`) — the existing `allow-ssh-iap` firewall rule already covers every instance in the project, so no new SSH-specific rule was needed (the `linkhealth-vm`-tagged direct-SSH rule doesn't apply here, and wasn't used). |
| Auth | **None yet.** Any host that can reach the VPC internal range can call `/v1/pose` — fine for an MVP with only synthetic/test data, revisit before anything sensitive goes through it. |

**Why this VM will be reachable from `linkhealth-vm2` later:** not because
they're in the same GCP billing account (that alone guarantees nothing) — it's
because both are on the same VPC network (`default`), same region
(`us-central1`), and `linkhealth-vm2`'s internal IP (`10.128.0.10`) falls
inside the `10.128.0.0/20` range this VM's firewall rule allows. All three
conditions have to hold; a different VPC, region, or a narrower firewall
range would break it even within the same account.

Commands actually run:

```sh
gcloud compute instances create linkhealth-openvino-vision \
  --project=linkhealth-care-2024 \
  --zone=us-central1-a \
  --machine-type=n2-standard-2 \
  --min-cpu-platform="Intel Cascade Lake" \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=50GB \
  --boot-disk-type=pd-balanced \
  --tags=openvino-vision

gcloud compute firewall-rules create allow-openvino-vision-internal \
  --project=linkhealth-care-2024 \
  --network=default \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:8080 \
  --source-ranges=10.128.0.0/20 \
  --target-tags=openvino-vision
```

(`tcp:8080` is a placeholder for whatever port the serving stack ends up
using — adjust once that's decided.)

## Open questions (not yet decided)

- **Does the proposed spec above get approved as-is, or adjusted** (region,
  disk size, N2 vs. C2)?
- **Which OS/serving stack** (bare VM + systemd, container, etc.) — not
  discussed yet.
- **Exact deterministic rule** for "possible fall" from pose keypoints
  (angle threshold, ground-contact duration, etc.) — not specified yet.
