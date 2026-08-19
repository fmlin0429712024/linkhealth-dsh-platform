# dsh-vision-insights-plugin

**Status: `query_vision_events` implemented (2026-08-19), not yet deployed.**

This plugin is the **DSH-side access point for vision insights**. Per the
agreed architecture ([docs/PRD-vision-insights.md](../../docs/PRD-vision-insights.md)),
the OpenVINO visual app and DSH are **completely separate applications**:

- The **OpenVINO visual app** (Intelligent Queue Management kit: YOLOv8m
  people counting in zones + capacity flagging) is an edge application with
  **its own storage** — a JSONL log ingested into a SQLite datastore, served
  through a thin read API. It lives in `infra/openvino-queue-kit/` and
  `infra/vision-insights-store` conventions (see the PRD), is deployed
  manually, and is **not part of this plugin**.
- **This plugin only reads through that API** — it never contains, imports,
  or bundles the OpenVINO app or its storage. `query_vision_events` calls
  `GET {baseUrl}/v1/events` and returns the raw events plus a deterministic
  per-zone summary; the LLM narrates that summary, it never recomputes or
  second-guesses it (same pattern as `dsh-cdi-plugin`'s `cdi_query_rule`) and
  never sees raw images/video.

## Why the previous tool is gone

`assess_exercise_form` (single-frame PT/rehab form check) was retired on
2026-08-19: it coupled DSH directly to an OpenVINO pose endpoint (POST image
→ keypoints), which contradicts the decoupled architecture, and its
attachment-image use case is blocked by the harness text-route gate anyway
(that UX belongs to `dsh-vision-router`). The code remains in git history
(`plugins/dsh-vision-insights-plugin` at commit `320bc37`).

## The tool

**`query_vision_events(since?, zone?, limit?)`** → `{ events, summary }`
(or `{ events: [], summary: [], error }` on failure — the tool never throws,
it returns a renderable error result). `summary` is a per-zone rollup:
`{ zone, events, overCapacityEvents, maxCount }`.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | `''` | Base URL of the insight data source read API, e.g. `http://10.128.0.11:8090` for the current showcase deployment. Required — the tool errors clearly if unset. |

## Development & test

```sh
node --test                                   # lib/query-events.js (HTTP-mocked) + plugin wiring
node scripts/check-plugin-contract.mjs        # repo contract check (from repo root)
```

`test/query-events.test.mjs` covers the pure query/summary logic with a
mocked `fetchImpl` — no real network call, no dependency on the VM being up.
`test/plugin-contract.test.mjs` covers the Cordis wiring (tool + prompt
section registered/disposed correctly).

Everything here is synthetic/test data only (a queue-management simulation
over a stock sample video) — never real patient data, never a clinical
decision.
