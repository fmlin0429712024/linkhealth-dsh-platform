# CI/CD — the complete pipeline (one document to follow)

This is the authoritative CI/CD playbook for
[linkhealth-dsh-platform](https://github.com/fmlin0429712024/linkhealth-dsh-platform).
It covers everything from a local commit to a running VM — the tests, the
gates, the deployment, and how to add a new plugin. **Follow this document
and you get the full pipeline for free; there is no per-plugin CI config.**

## The pipeline in one picture

```
developer                     GitHub Actions (this repo)
─────────                     ──────────────────────────
git commit
git push (PR branch)   ───►   CI (ci.yml)                 ← PR gate
  open PR                        ├─ pnpm test             (L1: every plugin's
                                 └─ contract check        (L2: zero-dep)
  PR merged to main
git push main           ───►   CI (ci.yml)                ← same checks again
                                 └─ Deploy (deploy.yml)
                                     ├─ e2e job           (L3: headless E2E
                                     │                      gate — real LLM)
                                     ├─ build release     (tarball from plugins/)
                                     ├─ upload → deploy.sh→ VM2
                                     └─ health check      (L4)
```

Gates in order: **L1 deterministic tests → L2 contract check → L3 headless
E2E → L4 deploy health check**. Each gate must pass before the next runs.

## Local development loop (before you push)

```sh
pnpm install
pnpm test                  # all plugin tests (GUI 22, triage guardrail 6, CDI rules 10)
pnpm test:contract         # plugin contract self-check (naming/paths/exports/tests)
node scripts/check-plugin-contract.mjs   # same thing, no pnpm needed

# full local stack, all plugins from this checkout:
dsh --profile linkhealth2 --port 3083     # → http://127.0.0.1:3083

# headless single-task smoke (what CI's e2e job runs):
DSH_HOME=$PWD/.dsh-e2e-home bash scripts/e2e-smoke.sh
```

## PR flow (what CI runs for every pull request)

`ci.yml` runs on **every PR and every push to main**:

| Step | Command | Catches |
|---|---|---|
| `pnpm test` | recursive `test` across `plugins/*` | broken plugin logic |
| contract check | `node scripts/check-plugin-contract.mjs` | a package that violates the repo conventions |

Both are free, deterministic, and **secret-free — so they run on fork PRs
too**. A PR is not mergeable until both are green.

## Push-to-main flow (deploy pipeline)

`deploy.yml` triggers on pushes to `main` touching `plugins/**`, `deploy/**`,
or the workflows themselves (also via manual *Run workflow* dispatch).
**Docs-only changes never trigger it**: a `!**/*.md` exclusion inside `paths`
means a README/docs edit only runs the cheap `ci.yml` checks — it does not
spin up the E2E gate or a deploy.

1. **e2e job — the pre-deploy gate.** Installs the dsh CLI, writes
   `DEEPSEEK_API_KEY` into a throwaway `$DSH_HOME`, then runs
   `scripts/e2e-smoke.sh`: a real headless DSH profile boots with the triage
   + CDI plugins **from this checkout** and executes three fixed LLM tasks:

   | Task | Asserts |
   |---|---|
   | `cdi-rule-syn-ichd-01` | `TRIGGERED` (deterministic rule result) |
   | `triage-full-flow` | `Process & Workflow Automation` (skill rubric) |
   | `triage-guardrail` | guardrail / BLOCKED / requires_human_review |

   **If any task fails, the deploy job does not run** — the release never
   reaches the VM. This is the cheapest place for an E2E gate: nothing has
   been deployed yet, so a failure costs nothing to recover from.
   *Why not on PRs:* LLM tasks cost tokens, are mildly flaky, and GitHub
   hides secrets from fork PRs — so E2E runs where it is most valuable (the
   only step that actually mutates the VM) and where secrets exist.

2. **build** — creates the self-contained release tarball from `plugins/`
   (profile template + the three plugin packages + the GUI node_modules
   symlink).

3. **upload** — scp's the tarball (and `deploy.sh`) to the VM.

4. **deploy** — `deploy.sh` unpacks to an immutable release dir, wires the
   CDI `@deepseek-ai` module resolution, switches the `current` symlink,
   restarts the service, and health-checks `http://localhost:3080`.

5. **verify** — `DEPLOY_OK` requires the HTTP check; rollback is a symlink
   switch (see below).

## The deploy target

| | |
|---|---|
| VM | `linkhealth-vm2` (GCP, us-central1-a, Debian 12, e2-standard-2) |
| Static IP | `34.134.224.75` (the `DEPLOY_HOST` secret) |
| Service | systemd `linkhealth.service` → `dsh --profile linkhealth --port 3080` |
| Local access | `ssh -i ~/.ssh/linkhealth-deploy-key -f -N -L 3084:localhost:3080 fmlin@34.134.224.75` → http://127.0.0.1:3084 |
| Releases | `/opt/linkhealth/releases/<sha>/`, `current` → active release |

### Required repository secrets

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | `34.134.224.75` |
| `DEPLOY_USER` | `fmlin` |
| `DEPLOY_SSH_KEY` | base64 (single line) of the private half of `~/.ssh/linkhealth-deploy-key` |
| `DEEPSEEK_API_KEY` | the DeepSeek API key (used by DSH on the VM **and** by the e2e gate) |

Set them once per repo: GitHub → Settings → Secrets and variables → Actions,
or `gh secret set <NAME> --repo fmlin0429712024/linkhealth-dsh-platform < <file>`.

### Manual triggers & rollback

```sh
# manual deploy (no code change):
#   GitHub → Actions → Deploy LinkHealth VAS → Run workflow

# rollback (SSH to the VM):
sudo ln -sfn /opt/linkhealth/releases/<previous-sha> /opt/linkhealth/current
sudo systemctl restart linkhealth
```

## Adding a new plugin (by anyone)

1. Create `plugins/dsh-<domain>-plugin/` — folder name == `package.json`
   `name`; declare `dsh.bundle.patch` (host) or `dsh.client.platform`
   (client); ship `lib/index.js` (export `name`/`inject`/`apply`), a
   README, and a test entry (`"scripts": {"test": "..."}` or
   `scripts/test_*.py`).
2. **That's it for testing** — `pnpm test` picks the package up via the
   workspace recursion, and the contract check validates it automatically.
3. To ship it to the VM: add its row to
   `deploy/profile-linkhealth/cordis.patch.yml` and a `cp -r` line to the
   deploy workflow's build step; mirror the CDI `@deepseek-ai` wiring in
   `deploy.sh` if it imports platform packages directly.
4. Follow the testing tiers: keep a deterministic stdlib-only test suite
   (L1) — the headless E2E gate (L3) is the optional live integration layer.

Full details: [plugin-development.md](plugin-development.md) (dev contract),
[deployment-gcp.md](deployment-gcp.md) (VM provisioning from scratch).

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| CI red on `pnpm test` | a plugin's deterministic test failed — run it locally, fix, re-push |
| CI red on contract check | package violates conventions — read the FAIL line, fix naming/paths/tests |
| Deploy e2e job red | headless LLM task failed — view the job log's task output; the marker is listed |
| Deploy step red, `service not responding` | SSH to the VM, `journalctl -u linkhealth -n 30`, fix, redeploy |
| `deploy.sh: No such file or directory` | the workflow always ships `deploy.sh` — a fresh VM just needs `bootstrap-vm.sh` once |
| `EACCES ... dsh-home` | bootstrap must `chown -R <user> /opt/linkhealth/dsh-home` (already in `bootstrap-vm.sh`) |

## Cost & hygiene

- e2e gate spends a small amount of DeepSeek tokens per push (~3 short
  tasks); the VM costs ≈ $52/mo while running. Stop the VM when idle:
  `gcloud compute instances stop linkhealth-vm2`.
- All bundled data is synthetic — no real patient/provider/client data.

