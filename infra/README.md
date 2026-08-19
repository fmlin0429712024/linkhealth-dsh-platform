# infra/

Standalone OpenVINO edge applications that sit *outside* the `plugins/`
workspace. This directory is where any future OpenVINO/edge-inference
project should land — read this file before adding a new one.

## Why this lives outside `plugins/`

`plugins/*` is a pnpm workspace of Cordis/DSH plugin packages
(`pnpm-workspace.yaml: packages: plugins/*`), each checked by
`scripts/check-plugin-contract.mjs` against the DSH plugin contract (host/
client entry exports, `dsh.bundle.patch` or `dsh.client.platform`, a test
entry, etc.). Everything under `infra/` is a different kind of thing:
infrastructure for a service that runs independently on its own VM — its
own process, its own deploy lifecycle, no Cordis plugin contract to
satisfy. It's a sibling to `deploy/` (which provisions the VM for *this
repo's DSH profile* — a separate concern) rather than something bundled
into any npm package.

A DSH plugin may eventually talk to something in here over HTTP (see
`plugins/dsh-vision-insights-plugin`'s `query_vision_events` tool), but it
never imports or bundles code from `infra/` directly — the only contract
between the two sides is whatever HTTP API the `infra/` service exposes.
See [docs/PRD-vision-insights.md](../docs/PRD-vision-insights.md) for the
full architecture and why it's deliberately decoupled this way.

## Convention for a new OpenVINO reference-kit project

The two kit directories below both follow the same shape — copy it for the
next one:

- `<project>/repo/` — a **gitignored** local clone of the upstream kit
  (sparse-checkout to just the relevant subfolder, `--filter=blob:none` to
  avoid pulling the whole upstream monorepo's history). Never commit this —
  it's someone else's repo with its own history, and reference kits tend to
  bundle large sample videos via Git LFS that would bloat this repo for no
  reason. Add the path to the root `.gitignore` when you create it.
- `<project>/run_demo.sh` (+ any driver script it needs, e.g. a Python
  headless-mode shim) — **tracked**. This is the one-command "prove it
  still works" entry point, and the only piece of the project that's
  actually ours.
- `<project>/README.md` — **tracked**. Project-specific only: what model it
  runs, how to set up its venv, how to run the demo, what its output event
  shape looks like, and any known issues/workarounds. Don't repeat the
  "why infra/", decoupled-architecture, or Insight Storage material — that
  all lives here and in the PRD; link to it instead.

## Projects

| Directory | Status | What it does |
| --- | --- | --- |
| [`openvino-queue-kit/`](openvino-queue-kit/README.md) | 🟢 production data source | People-counting/capacity-flagging (YOLOv8m INT8). Feeds the Insight Storage layer that `dsh-vision-insights-plugin`'s `query_vision_events` tool actually queries today. |
| [`openvino-self-checkout/`](openvino-self-checkout/README.md) | 🟡 verified locally, not deployed | Retail item add/remove tracking (YOLOv8m FP16). Headless driver works end-to-end against the sample video; its events are ingestible (see `vision-insights-store/`) but the kit itself isn't deployed to a VM yet. |
| [`vision-insights-store/`](vision-insights-store/README.md) | 🟡 version-controlled + locally verified, not redeployed | SQLite + FastAPI read API sitting between both kits above and DSH. Local ingest→serve→query round-trip verified for both event shapes; the VM is still running the older, not-yet-version-controlled copy. |

`openvino-vision/` (an earlier pose-estimation showcase — fall detection,
then PT/rehab exercise tracking) was removed from this directory on
2026-08-19: both use cases it explored are now decided (one rejected, one
retired for an architecture reason), and this repo doesn't keep retired
exploratory code in the working tree — see the "Evidence behind the two
rejected/retired directions" section in
[docs/PRD-vision-insights.md](../docs/PRD-vision-insights.md) for what was
actually learned, and `git log` for the removed code itself if ever needed.

## The Insight Storage layer

[`vision-insights-store/`](vision-insights-store/README.md) is the shared
SQLite + FastAPI read API both kits feed, and the only thing
`dsh-vision-insights-plugin` is allowed to query — see
[docs/PRD-vision-insights.md](../docs/PRD-vision-insights.md) §3 for the
architecture. One table + one read endpoint per source kit (`events` /
`GET /v1/events` for the queue kit, `checkout_events` /
`GET /v1/checkout-events` for self-checkout) rather than one shared schema —
see that directory's README for why. As of 2026-08-19 this is
version-controlled and locally verified but not yet redeployed to
`linkhealth-openvino-vision`, which is still serving from the older,
pre-version-control copy.
