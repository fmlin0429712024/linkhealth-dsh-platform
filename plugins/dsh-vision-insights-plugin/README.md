# dsh-vision-insights-plugin

**Status: scaffold — integration not started (2026-08-19).**

This plugin is the **DSH-side access point for vision insights**, planned as a
data-source query tool for certain questions. Per the agreed architecture
([docs/PRD-vision-insights.md](../../docs/PRD-vision-insights.md)), the
OpenVINO visual app and DSH are **completely separate applications**:

- The **OpenVINO visual app** (queue management kit: YOLOv8m people counting in
  zones + capacity flagging) is an edge application with **its own storage**
  (insight events). It lives in `infra/` terms, is deployed manually, and is
  **not part of this plugin**.
- **This plugin does not contain, call, or own any of that** — it registers no
  tools yet. Once the insight data source exists (Phase 2: SQLite + thin
  `GET /v1/events` read API), this plugin will add a
  `query_vision_events`-style tool that reads structured events through a
  `baseUrl` config entry. LLMs never see images — only deterministic facts.

## Why the previous tool is gone

`assess_exercise_form` (single-frame PT/rehab form check) was retired on
2026-08-19: it coupled DSH directly to an OpenVINO pose endpoint (POST image →
keypoints), which contradicts the decoupled architecture, and its
attachment-image use case is blocked by the harness text-route gate anyway
(that UX belongs to `dsh-vision-router`). The code remains in git history
(`plugins/dsh-vision-insights-plugin` at commit `320bc37`).

## Config (future)

| Key | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | `''` | Base URL of the insight data source read API (`/v1/events`). Used by the future query tool. |

## Development & test

```sh
node --test                                   # entry-contract tests (scaffold)
node scripts/check-plugin-contract.mjs        # repo contract check (from repo root)
```

Everything here is synthetic/test data only — never real patient data, never a
clinical decision.
