# Deployment — LinkHealth VAS on GCP (CI/CD)

Goal: run the `linkhealth` profile (DSH + triage + CDI + GUI plugins) on a GCP
VM via **CI/CD** — push to `main` of
[`linkhealth-dsh-platform`](https://github.com/fmlin0429712024/linkhealth-dsh-platform)
deploys. The release directory (profile + plugins) is a **self-contained
deploy unit**: the same files that run locally run on the VM, and rollback is
a symlink switch.

**This repo is the single source of truth for the DSH plugins.** The deploy
unit is built from `plugins/` here; nothing on the VM comes from the earlier
explore workspaces ([`linkhealth-triage`](https://github.com/fmlin0429712024/linkhealth-triage),
[`clinical-documentation-audit-poc`](https://github.com/fmlin0429712024/clinical-documentation-audit-poc)).

## How it works

```
GitHub push main (plugins/** | deploy/** | workflow)
  → .github/workflows/deploy.yml (GitHub Actions)
      → build dist/profile/  (deploy template + 4 plugins + relative symlink)
      → tar → scp → VM:/opt/linkhealth/incoming/
      → ssh → deploy.sh: unpack → wire CDI → switch `current` → restart → health check
```

- **Immutable releases**: `/opt/linkhealth/releases/<sha>/` per deploy; `current`
  is a symlink. Rollback = point `current` at a previous release + restart.
- **Self-contained**: `cordis.patch.yml` uses **relative** paths
  (`./plugins/dsh-triage-plugin/lib/index.js`, `./plugins/dsh-cdi-plugin/lib/index.js`)
  and a relative `node_modules` symlink for the GUI plugin — the release folder
  is portable and identical everywhere.
- **CDI module wiring**: `dsh-cdi-plugin` imports `@deepseek-ai/*` directly;
  `deploy.sh` creates one symlink per release
  (`plugins/dsh-cdi-plugin/node_modules/@deepseek-ai` →
  `$DSH_HOME/profiles/node_modules/@deepseek-ai`, the flat fallback dsh
  maintains on every boot). Validated locally in the release-layout test.

## Topology

```
GitHub Actions ──scp/ssh──► GCP VM (linkhealth-vm2, us-central1-a)
                              systemd: linkhealth.service
                              /opt/linkhealth/
                                releases/<sha>/    immutable deploy units
                                current → releases/<sha>
                                dsh-home/profiles/linkhealth → current
                                scripts/{bootstrap,deploy}.sh
```

Access for humans: `gcloud compute ssh linkhealth-vm2 -- -L 3084:localhost:3080`
(SSH tunnel; no public port for the app).

## Port convention (local ↔ VMs)

| Address | What it is |
|---|---|
| `http://127.0.0.1:3080` | **Local Dev profile** (the Harness default) — never tunnel into it |
| `http://127.0.0.1:3081` | **Local `linkhealth` profile** (legacy dev copy — old workspace) |
| `http://127.0.0.1:3082` | **Tunnel → VM1** (`linkhealth-vm`, the original deploy — kept for the current demo) |
| `http://127.0.0.1:3083` | **Local `linkhealth2` profile** — the source-of-truth stack (all 3 plugins from this repo) |
| `http://127.0.0.1:3084` | **Tunnel → VM2** (`linkhealth-vm2`, the new CI/CD deploy target) |

## Provision a new target VM (VM2)

One-time setup, run from your machine (not in the repo sandbox):

```sh
# 1. Firewall rule for SSH (skip if `allow-ssh-linkhealth` already exists)
gcloud compute firewall-rules create allow-ssh-linkhealth \
  --allow tcp:22 --target-tags linkhealth-vm \
  --description "SSH to LinkHealth VMs"

# 2. Create the VM (Debian 12, e2-standard-2, 20GB — same class as VM1)
gcloud compute instances create linkhealth-vm2 \
  --zone us-central1-a \
  --machine-type e2-standard-2 \
  --image-family debian-12 --image-project debian-cloud \
  --boot-disk-size 20GB \
  --tags linkhealth-vm \
  --metadata enable-oslogin=FALSE

# 3. Reserve a static IP (the DEPLOY_HOST secret must be stable)
gcloud compute addresses create linkhealth-vm2-ip --region us-central1
gcloud compute instances delete-access-config linkhealth-vm2 \
  --access-config-name "external-nat" --zone us-central1-a
gcloud compute instances add-access-config linkhealth-vm2 \
  --access-config-name "external-nat" \
  --address "$(gcloud compute addresses describe linkhealth-vm2-ip \
      --region us-central1 --format='value(address)')" \
  --zone us-central1-a
IP=$(gcloud compute addresses describe linkhealth-vm2-ip --region us-central1 --format='value(address)')
echo "VM2 IP: $IP"

# 4. Bootstrap (installs Node 22 + dsh CLI + release layout + systemd unit)
scp deploy/scripts/bootstrap-vm.sh "fmlin@$IP:~"
ssh "fmlin@$IP" "sudo bash bootstrap-vm.sh"

# 5. Authorize the CI deploy key (same keypair VM1 uses)
#    DEPLOY_SSH_KEY secret = base64 of ~/.ssh/linkhealth-deploy-key
ssh "fmlin@$IP" 'mkdir -p ~/.ssh && chmod 700 ~/.ssh'
cat ~/.ssh/linkhealth-deploy-key.pub | ssh "fmlin@$IP" 'cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'

# 6. Sanity: log in over the deploy key
ssh -i ~/.ssh/linkhealth-deploy-key -o StrictHostKeyChecking=no "fmlin@$IP" 'echo deploy-key-ok'
```

(If `gcloud compute ssh` asks for a project/account, add `--project <your-project>`.
The default SSH user is your local username, `fmlin` — same as VM1.)

## Required GitHub repository secrets (on THIS repo)

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | VM2 static IP (from step 3) |
| `DEPLOY_USER` | `fmlin` |
| `DEPLOY_SSH_KEY` | base64 (single line) of the private half of `~/.ssh/linkhealth-deploy-key` |
| `DEEPSEEK_API_KEY` | the DeepSeek key used by DSH on the VM |

Set via the GitHub UI (Settings → Secrets and variables → Actions) or:
`gh secret set <NAME> --repo fmlin0429712024/linkhealth-dsh-platform < <value-file>`
(gh reads the value from stdin; never put secret values in shell arguments.)

## Deploying

```sh
git push origin main                    # auto-deploys when plugins/deploy/workflow change
# or manual:
# GitHub → Actions → Deploy LinkHealth VAS → Run workflow
```

Verify: `systemctl status linkhealth` → active; `curl localhost:3080` on the
VM → the LinkHealth branded UI; run one triage case and one CDI rule query —
the guardrail backstop and the deterministic rules run on the VM too.

## Vision multimodality: dsh-vision-router → local Phi-3.5-vision

One plugin, one existing model-picker entry, two backends in a fallback
chain — not two separate features. `dsh-vision-router` (third-party, see
[plugin-development.md](plugin-development.md#adopting-an-existing-plugin-vs-building-a-new-one))
gives the text-only DeepSeek main model "eyes." Its own code owns a fixed
backend priority order (registered adapters → local Ollama → local LM
Studio → custom `httpProviders` → free OVH cloud fallback, always last) —
we only ever *configure* which of those slots are filled, never modify the
plugin's routing logic itself.

**Before this change**: every slot except the last was empty, so image
attachments always fell straight through to the free OVH cloud engine — the
"DeepSeek + 自动识图" model-picker entry (auto-created by `autoWrapProviders`,
which never touches the original "DeepSeek" entry — plain-text selection is
completely unaffected either way) was already working on that cloud path.

**What changed**: the previously-empty `httpProviders` slot now points at a
locally-deployed Phi-3.5-vision-instruct model
([infra/openvino-vlm-kit](../infra/openvino-vlm-kit/README.md)), which sits
ahead of the cloud fallback in that same priority order:

```yaml
# deploy/profile-linkhealth/cordis.patch.yml — config override on the
# existing 'vision-router' id (not a second insert)
- id: vision-router
  config:
    httpProviders:
      - name: phi35-vision-local
        baseURL: 'http://10.128.0.11:8092/v1'   # linkhealth-openvino-vision, same VPC
        model: 'phi-3.5-vision-local'
        maxTokens: 200
```

```yaml
# .github/workflows/deploy.yml — version bump, not a new install step
# dsh-vision-router@1.2.2 → @1.7.0: 1.2.2 (pinned when the plugin was first
# adopted 2026-08-17, wired with zero custom config) predates the
# httpProviders/local-backend feature entirely (added in the plugin's own
# v1.5.0) — the config above would have been silently ignored without this
# bump. Pin to a version you've actually tested, not "latest": this plugin
# ships new releases every day or two.
```

**Incident hit on first deploy of this version bump (2026-08-20, fixed same
day)**: 1.7.0 imports `@deepseek-ai/dsh-llm-deepseek` directly (its rebuilt
official-DeepSeek-route detection — not present in 1.2.2), but
`deploy/scripts/deploy.sh` only wired the equivalent `@deepseek-ai/*`
module-resolution fallback for `dsh-cdi-plugin`, not for `dsh-vision-router`
(installed straight into the release's own `node_modules`, not under
`plugins/`). Result: `ERR_MODULE_NOT_FOUND`, service crash-loop, failed
health check. Fixed by extending the same symlink trick to
`node_modules/dsh-vision-router/node_modules/@deepseek-ai` in `deploy.sh` —
a version bump of a plugin with direct `@deepseek-ai/*` imports needs this
checked, the same way `dsh-cdi-plugin` already required it.

Topology: `linkhealth-vm2` (10.128.0.10) → `linkhealth-openvino-vision`
(10.128.0.11:8092), same VPC subnet (`default`, `10.128.0.0/20`) — no
tunnel between the two VMs, direct internal networking (same pattern
already proven by `vision-insights-store` at `10.128.0.11:8090`). Firewall:
`allow-openvino-vlm-api-internal` (internal-only, tcp:8092).

Verified end-to-end before this config was written (independent scratch DSH
profile on `linkhealth-vm2`, same plugin/version/config, no other plugins
loaded) — see [infra/openvino-vlm-kit/README.md](../infra/openvino-vlm-kit/README.md)
for the model-side smoke test transcript. Expect the local backend to be
noticeably slower than the cloud fallback it now takes priority over (~46s,
CPU-only 4.2B-parameter inference vs. a few seconds for the cloud engine) —
that's the known cost of a private, self-hosted, non-rate-limited backend,
not a routing bug. If `openvino-vlm-api` on the vision VM is ever down, the
chain gracefully falls through to the same free cloud engine that already
worked before this change — no user-facing failure mode, just slower vs.
faster.

Demo (once deployed): open the model picker on the live profile, select
"DeepSeek + 自动识图", attach an image, ask about it.

Rollback:

```sh
ssh fmlin@<VM2-IP>
sudo ln -sfn /opt/linkhealth/releases/<previous-sha> /opt/linkhealth/current
sudo systemctl restart linkhealth
```

## Local validation before any deploy

The whole deploy unit is validated locally before it ever reaches a VM:

```sh
# 1. plugin tests
(cd plugins/dsh-linkhealth-gui-plugin && node --test)
python3 plugins/dsh-triage-plugin/scripts/test_validate_triage_log.py

# 2. full-stack local profile (linkhealth2, port 3083): triage + CDI + GUI
dsh --profile linkhealth2 --port 3083

# 3. release-layout test: build the tarball, unpack, boot it on a scratch
#    DSH home (see deploy/scripts and docs for the exact CI build steps)
```

## Cost & hygiene

- e2-standard-2 in us-central1 ≈ $49/mo + static IP ≈ $3/mo. Stop the VM when
  unused: `gcloud compute instances stop linkhealth-vm2`.
- DeepSeek API: set a monthly budget + alert in the DeepSeek console — the
  deployment never controls spend, the account does.
- Synthetic data only. Before ANY real client/PHI data: region choice,
  encryption, audit logging, customer data-processing agreement.

## Migration note (VM1 → VM2)

VM1 (`linkhealth-vm`, 35.188.149.18) and the old `linkhealth-triage` deploy
workflow stay untouched while the current demo is live. VM2 is the new
CI/CD target for this repo; once the demo is over, VM1 can be retired
(`gcloud compute instances delete linkhealth-vm`) and the old repo's
workflow disabled.
