#!/usr/bin/env bash
# Deploy one release tarball onto the VM. Runs as root (sudo), invoked by CI.
#
#   sudo bash deploy.sh <release-file.tar.gz> <deepseek-api-key>
#
# Layout:
#   /opt/linkhealth/releases/<name>/   one immutable release (profile + plugins)
#   /opt/linkhealth/current            symlink → active release
#   /opt/linkhealth/dsh-home/profiles/linkhealth → current
#
# Source: deploy/scripts/deploy.sh in
# github.com/fmlin0429712024/linkhealth-dsh-platform
set -euo pipefail

RELEASE_FILE="$1"
DEEPSEEK_KEY="${2:-}"

NAME="$(basename "$RELEASE_FILE" .tar.gz)"
RELEASE_DIR="/opt/linkhealth/releases/$NAME"

echo "==> Unpack $RELEASE_FILE → $RELEASE_DIR"
mkdir -p /opt/linkhealth/releases
rm -rf "$RELEASE_DIR"
mkdir -p /tmp/linkhealth-unpack
tar -xzf "/opt/linkhealth/incoming/$RELEASE_FILE" -C /tmp/linkhealth-unpack
mv /tmp/linkhealth-unpack/profile "$RELEASE_DIR"

echo "==> Wire CDI module resolution (dsh-managed flat fallback)"
# dsh-cdi-plugin imports @deepseek-ai/* directly (dsh-tools, schemastery).
# dsh maintains the flat module fallback $DSH_HOME/profiles/node_modules on
# every boot (one symlink per package in the installation closure), so a
# single symlink from the release's plugin dir makes those imports resolve —
# the same wiring the repo's dev profile uses. The tarball stays portable;
# this step is machine-specific and created per release.
mkdir -p "$RELEASE_DIR/plugins/dsh-cdi-plugin/node_modules"
ln -sfn /opt/linkhealth/dsh-home/profiles/node_modules/@deepseek-ai \
        "$RELEASE_DIR/plugins/dsh-cdi-plugin/node_modules/@deepseek-ai"

# the dsh service runs as the deploy user and writes back cordis.yml into the
# profile dir, so the release must be owned by that user (not root)
chown -R "$SUDO_USER" "$RELEASE_DIR"

echo "==> Point current → $NAME"
# `current` is created as a real directory by bootstrap, so replace it
# outright (rm + ln) rather than trying to overwrite in place.
rm -rf /opt/linkhealth/current
ln -s "$RELEASE_DIR" /opt/linkhealth/current
rm -f /opt/linkhealth/dsh-home/profiles/linkhealth
ln -s /opt/linkhealth/current /opt/linkhealth/dsh-home/profiles/linkhealth

echo "==> Credentials (DeepSeek key)"
if [ -n "$DEEPSEEK_KEY" ]; then
  mkdir -p /opt/linkhealth/dsh-home
  printf 'DEEPSEEK_API_KEY: %s\n' "$DEEPSEEK_KEY" > /opt/linkhealth/dsh-home/.credentials.yaml
  chmod 600 /opt/linkhealth/dsh-home/.credentials.yaml
  # the dsh service reads this as the deploy user (not root)
  chown "$SUDO_USER" /opt/linkhealth/dsh-home/.credentials.yaml
fi

echo "==> Restart service"
systemctl restart linkhealth
sleep 8

echo "==> Health check"
if curl -sf http://localhost:3080/ > /dev/null; then
  echo "DEPLOY_OK: $NAME (http://localhost:3080 responding)"
else
  echo "DEPLOY_FAILED: $NAME (service not responding)" >&2
  journalctl -u linkhealth --no-pager -n 20 >&2 || true
  exit 1
fi

# Rollback hint (keep in the docs):
#   ln -sfn /opt/linkhealth/releases/<previous> /opt/linkhealth/current
#   systemctl restart linkhealth
