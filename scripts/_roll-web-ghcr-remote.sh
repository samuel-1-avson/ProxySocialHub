#!/usr/bin/env bash
set -euo pipefail
OWNER="${1:?owner}"
TAG="${2:?tag}"

chmod 600 /tmp/.ghcr_token
cat /tmp/.ghcr_token | sudo docker login ghcr.io -u "$OWNER" --password-stdin
rm -f /tmp/.ghcr_token
echo LOGIN_OK

cd /opt/proxyhubb
sudo -E env IMAGE_TAG="$TAG" GHCR_OWNER="$OWNER" bash ./scripts/gcp-deploy-web.sh
sudo -E env REQUIRE_GHCR=1 REQUIRE_REDIRECTS=1 bash ./scripts/gcp-verify-web-deploy.sh
sudo docker logout ghcr.io >/dev/null 2>&1 || true
echo ROLL_DONE
