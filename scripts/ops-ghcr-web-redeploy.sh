#!/usr/bin/env bash
# Tag the current local web image and push to GHCR, then pull-deploy via gcp-deploy-web.sh.
#
# Usage (on VM):
#   GHCR_TOKEN=... GHCR_USER=samuel-1-avson IMAGE_TAG=invite-pack-20260808 \
#     bash scripts/ops-ghcr-web-redeploy.sh
#
# Or: GHCR_TOKEN_FILE=/tmp/ghcr.token ...
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

GHCR_USER="${GHCR_USER:-samuel-1-avson}"
GHCR_OWNER="${GHCR_OWNER:-samuel-1-avson}"
IMAGE_TAG="${IMAGE_TAG:-invite-pack-$(date -u +%Y%m%dT%H%M%SZ)}"
REMOTE="ghcr.io/${GHCR_OWNER}/web:${IMAGE_TAG}"

TOKEN=""
if [[ -n "${GHCR_TOKEN_FILE:-}" && -f "$GHCR_TOKEN_FILE" ]]; then
  TOKEN="$(tr -d '\r\n' <"$GHCR_TOKEN_FILE")"
  shred -u "$GHCR_TOKEN_FILE" 2>/dev/null || rm -f "$GHCR_TOKEN_FILE"
elif [[ -n "${GHCR_TOKEN:-}" ]]; then
  TOKEN="$GHCR_TOKEN"
else
  echo "FATAL: set GHCR_TOKEN or GHCR_TOKEN_FILE" >&2
  exit 2
fi

LOCAL_IMAGE="$(docker inspect proxyhubb-web-1 --format '{{.Image}}' 2>/dev/null || true)"
if [[ -z "$LOCAL_IMAGE" ]]; then
  LOCAL_IMAGE="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^proxyhubb-web:' | head -1 || true)"
fi
[[ -n "$LOCAL_IMAGE" ]] || { echo "FATAL: no local web image (proxyhubb-web-1)"; exit 2; }

echo "local_image=$LOCAL_IMAGE"
echo "remote=$REMOTE"

echo "$TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
docker tag "$LOCAL_IMAGE" "$REMOTE"
docker tag "$LOCAL_IMAGE" "ghcr.io/${GHCR_OWNER}/web:latest" || true
docker push "$REMOTE"
docker push "ghcr.io/${GHCR_OWNER}/web:latest" || true

# Persist tag for future rolls
if grep -q '^IMAGE_TAG=' .env 2>/dev/null; then
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${IMAGE_TAG}/" .env
else
  echo "IMAGE_TAG=${IMAGE_TAG}" >> .env
fi
if grep -q '^GHCR_OWNER=' .env 2>/dev/null; then
  sed -i "s/^GHCR_OWNER=.*/GHCR_OWNER=${GHCR_OWNER}/" .env
else
  echo "GHCR_OWNER=${GHCR_OWNER}" >> .env
fi

export IMAGE_TAG GHCR_OWNER
bash scripts/gcp-deploy-web.sh

echo "=== verify banner still present ==="
curl -sS -m 20 https://proxyhubb.com/ | grep -o 'Solana[^<]*Testnet\|test SOL only\|not trustless' | head -10 || true
echo "GHCR_WEB_REDEPLOY_DONE tag=$IMAGE_TAG"
