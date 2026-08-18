# dsh-vision-plugin

**Status: placeholder.** `lib/index.js` only registers a system-prompt
section announcing the plugin is scaffolded but not implemented — no tools,
no vision-backend call. See "Next" below for what's actually planned and
already verified elsewhere.

## What this will be

A DSH host plugin exposing care-relevant tools backed by a vision-capable
inference service, reached through a `baseUrl` config entry (never bundled
or hard-coded — see "Design" below).

**Verified use case (not yet implemented here): PT/rehab exercise form
tracking**, not fall detection. Real testing against the OpenVINO showcase
in [`infra/openvino-vision/`](../../infra/openvino-vision/README.md) showed
`human-pose-estimation-0001` reliably tracks a held/controlled exercise
movement (a bicep-curl elbow-angle curve, confidence self-consistent
throughout) but is unreliable once a subject is lying down (confidence
collapses — likely an out-of-distribution problem for the model, not
something a decoder fix solves). Fall detection and lying-position
classification were evaluated and explicitly rejected as this model's first
use case for that reason. See that README's "Use case decision" section for
the full evidence trail before building tools here.

## Design

- Talks to a vision-backend service over a `baseUrl`/`apiKey`-style config,
  OpenAI-compatible where practical — never imports or bundles the inference
  service itself. The currently-running showcase backend is documented in
  [`infra/openvino-vision/`](../../infra/openvino-vision/) (a FastAPI service
  on a dedicated GCP VM, reachable only from inside the VPC).
- Any tool built here should keep this repo's existing pattern: a
  deterministic rule decides (geometry over model keypoints, not an LLM
  judgment call), the LLM only narrates the result — see `dsh-cdi-plugin`'s
  `cdi_query_rule` for the established precedent.

## Next

Not started: the actual tool(s) (e.g. an `assess_exercise_form`-style tool),
the `baseUrl`/`apiKey` config schema, and the structured output shape. Follow
[docs/plugin-development.md](../../docs/plugin-development.md) for the
naming/packaging contract this package already satisfies (folder name ==
`package.json` name, `dsh.bundle.patch` declared, test entry present, host
entry exports `name`/`inject`/`apply`).

## Test

```sh
node --test
```
