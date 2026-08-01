#!/usr/bin/env bash
# EMERGENCY ONLY — rebuild web from VM source (no GHCR).
#
# This path previously caused "two frontend" drift when mixed with GHCR pulls.
# Prefer: IMAGE_TAG=… ./scripts/gcp-deploy-web.sh
#
# Usage:
#   ALLOW_EMERGENCY_WEB_BUILD=1 ./scripts/gcp-deploy-web-emergency-build.sh
#
# Optional: extract a tarball into apps/ before building:
#   WEB_TAR=/tmp/web-….tar.gz ALLOW_EMERGENCY_WEB_BUILD=1 ./scripts/gcp-deploy-web-emergency-build.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/lib/gcp-web-policy.sh
source "$SCRIPT_DIR/lib/gcp-web-policy.sh"

if [[ "${ALLOW_EMERGENCY_WEB_BUILD:-}" != "1" ]]; then
  cat <<'EOF' >&2
Refusing emergency VM web build.

Set ALLOW_EMERGENCY_WEB_BUILD=1 only when GHCR is unavailable and you accept
host/image drift risk. Canonical path:

  IMAGE_TAG=<tag> ./scripts/gcp-deploy-web.sh
EOF
  exit 1
fi

PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DOCKER="${DOCKER:-docker}"
WEB_TAR="${WEB_TAR:-}"

gcp_web_compose_build "$PROJECT_DIR" "$DOCKER"

cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] EMERGENCY web build (NO gcp-images.yml)"
echo "WARNING: A later GHCR pull will overwrite this image."

if [[ -n "$WEB_TAR" ]]; then
  if [[ ! -f "$WEB_TAR" ]]; then
    echo "WEB_TAR not found: $WEB_TAR" >&2
    exit 1
  fi
  echo "Extracting $WEB_TAR → $PROJECT_DIR/apps"
  tar -xzf "$WEB_TAR" -C "$PROJECT_DIR/apps"
  find "$PROJECT_DIR/apps/web/src" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) \
    -exec sed -i 's/\r$//' {} + 2>/dev/null || true
fi

"${COMPOSE[@]}" build web
"${COMPOSE[@]}" up -d --no-deps --force-recreate web

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
  "$SCRIPT_DIR/gcp-verify-web-deploy.sh" || true
fi

echo "EMERGENCY_BUILD_DONE — schedule a GHCR-tagged redeploy ASAP"
