#!/usr/bin/env bash
# Canonical GCP web deploy — GHCR image pull only (no on-VM source build).
#
# Usage (on the GCE VM):
#   IMAGE_TAG=v1.2.3 ./scripts/gcp-deploy-web.sh
#   IMAGE_TAG=sha-abc1234 ./scripts/gcp-deploy-web.sh --full
#   IMAGE_TAG=v1.2.3 GHCR_OWNER=myorg ./scripts/gcp-deploy-web.sh
#
# --full  Also migrate + roll control-api / edge-gateway (same as gcp-compose-pull-deploy.sh)
#
# Auth (once per VM):
#   echo "$GHCR_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin
#
# Do NOT use scripts/_deploy-web-landing*.sh — they are retired stubs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/lib/gcp-web-policy.sh
source "$SCRIPT_DIR/lib/gcp-web-policy.sh"

PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
IMAGE_TAG="${IMAGE_TAG:?Set IMAGE_TAG (e.g. v1.2.3 or sha-abc1234)}"
GHCR_OWNER="${GHCR_OWNER:-samuel-1-avson}"
DOCKER="${DOCKER:-docker}"
MODE="web-only"

for arg in "$@"; do
  case "$arg" in
    --full) MODE="full" ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

export IMAGE_TAG GHCR_OWNER
gcp_web_compose_ghcr "$PROJECT_DIR" "$DOCKER"

cd "$PROJECT_DIR"

if [[ "$MODE" == "full" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Full stack pull deploy (tag=${IMAGE_TAG} owner=${GHCR_OWNER})"
  exec "$SCRIPT_DIR/gcp-compose-pull-deploy.sh"
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Web-only GHCR deploy (tag=${IMAGE_TAG} owner=${GHCR_OWNER})"
echo "Canonical URL: $PROXYHUBB_WEB_CANONICAL_URL"

"${COMPOSE[@]}" pull web
"${COMPOSE[@]}" up -d --no-deps --force-recreate web

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Waiting for web healthy…"
for i in $(seq 1 60); do
  st=$("${COMPOSE[@]}" ps web --format '{{.Status}}' 2>/dev/null || true)
  echo "try=$i $st"
  if echo "$st" | grep -qi healthy; then
    echo HEALTHY
    break
  fi
  sleep 5
done

if [[ -x "$SCRIPT_DIR/gcp-verify-web-deploy.sh" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running verify…"
  "$SCRIPT_DIR/gcp-verify-web-deploy.sh" || true
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Web deploy complete"
"${COMPOSE[@]}" ps web
