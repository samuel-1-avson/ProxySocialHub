#!/usr/bin/env bash
# Pull pinned GHCR images and roll the GCP Phase A stack (migrate first).
#
# This is the canonical full-stack deploy. For web-only rolls use:
#   IMAGE_TAG=v1.2.3 ./scripts/gcp-deploy-web.sh
#
# Usage (on the GCE VM):
#   IMAGE_TAG=v1.2.3 ./scripts/gcp-compose-pull-deploy.sh
#   IMAGE_TAG=sha-abc1234 GHCR_OWNER=myorg ./scripts/gcp-compose-pull-deploy.sh
#
# Auth (once per VM):
#   echo "$GHCR_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin
#
# Does NOT use --build. Emergency VM web build:
#   ALLOW_EMERGENCY_WEB_BUILD=1 ./scripts/gcp-deploy-web-emergency-build.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/lib/gcp-web-policy.sh
source "$SCRIPT_DIR/lib/gcp-web-policy.sh"

PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
IMAGE_TAG="${IMAGE_TAG:?Set IMAGE_TAG (e.g. v1.2.3 or latest)}"
GHCR_OWNER="${GHCR_OWNER:-samuel-1-avson}"
DOCKER="${DOCKER:-docker}"

gcp_web_compose_ghcr "$PROJECT_DIR" "$DOCKER"

export IMAGE_TAG GHCR_OWNER

cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Pulling images (tag=${IMAGE_TAG} owner=${GHCR_OWNER})"
"${COMPOSE[@]}" pull db-migrate control-api edge-gateway web

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running migrations (db-migrate)"
"${COMPOSE[@]}" run --rm db-migrate

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Rolling stack"
"${COMPOSE[@]}" up -d --remove-orphans

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Deploy complete"
"${COMPOSE[@]}" ps

if [[ -x "$SCRIPT_DIR/gcp-verify-web-deploy.sh" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Verifying web…"
  "$SCRIPT_DIR/gcp-verify-web-deploy.sh" || true
fi
