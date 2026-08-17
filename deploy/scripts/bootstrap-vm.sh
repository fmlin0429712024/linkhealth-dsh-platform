#!/usr/bin/env bash
# Bootstrap a fresh GCP VM into a LinkHealth deploy target. Idempotent — safe
# to re-run. Run as the deploy user (ubuntu) with sudo.
#
#   sudo bash bootstrap-vm.sh
#
# Installs: Node 22, the dsh CLI, the release layout, and the systemd unit.
# Source: deploy/scripts/bootstrap-vm.sh in
# github.com/fmlin0429712024/linkhealth-dsh-platform
set -euo pipefail

echo "==> Node 22"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "==> dsh CLI (global)"
if ! command -v dsh >/dev/null 2>&1; then
  npm install -g @deepseek-ai/dsh
fi
DASH_BIN="$(command -v dsh)"
echo "dsh at: $DASH_BIN"

echo "==> Release layout"
DEPLOY_USER="${SUDO_USER:-$USER}"
mkdir -p /opt/linkhealth/{incoming,releases,current,scripts}
mkdir -p /opt/linkhealth/dsh-home/profiles
# the deploy user (CI scp/ssh) owns incoming + scripts; releases/current stay root-owned
chown -R "$DEPLOY_USER" /opt/linkhealth/incoming /opt/linkhealth/scripts
# dsh runs as the deploy user with DSH_HOME=/opt/linkhealth/dsh-home: it must be
# able to create profiles/node_modules (module fallback) and write credentials/sessions
chown -R "$DEPLOY_USER" /opt/linkhealth/dsh-home

echo "==> systemd unit"
cat > /etc/systemd/system/linkhealth.service <<EOF
[Unit]
Description=LinkHealth VAS (dsh profile)
After=network-online.target

[Service]
User=$DEPLOY_USER
WorkingDirectory=/opt/linkhealth/current
Environment=DSH_HOME=/opt/linkhealth/dsh-home
ExecStart=$DASH_BIN --profile linkhealth --port 3080
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

echo "==> Bootstrap done. Next: add the deploy SSH public key, then run deploy.sh from CI."
