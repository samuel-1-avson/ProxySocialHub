#!/usr/bin/env bash
# Deploy Connect Integration Matrices web changes (emergency VM rebuild).
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
WEB_TAR="${WEB_TAR:?Set WEB_TAR to the uploaded tarball}"
DOCKER="${DOCKER:-docker}"

cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extracting $WEB_TAR"
tmpdir=$(mktemp -d)
tar -xzf "$WEB_TAR" -C "$tmpdir"

if [[ -d "$tmpdir/web" ]]; then
  mkdir -p "$PROJECT_DIR/apps/web"
  cp -a "$tmpdir/web/." "$PROJECT_DIR/apps/web/"
fi
rm -rf "$tmpdir"

find "$PROJECT_DIR/apps/web/src/app/dashboard/proxy" \
  "$PROJECT_DIR/apps/web/src/app/help" \
  -type f \( -name '*.ts' -o -name '*.tsx' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

if ! grep -q 'SDK_MATRIX' "$PROJECT_DIR/apps/web/src/app/dashboard/proxy/page.tsx"; then
  echo "ERROR: SDK_MATRIX missing after extract" >&2
  exit 1
fi
echo "HAS_SDK_MATRIX"

export ALLOW_EMERGENCY_WEB_BUILD=1
export PROJECT_DIR DOCKER
unset WEB_TAR
bash "$PROJECT_DIR/scripts/gcp-deploy-web-emergency-build.sh"

# Smoke: Connect page + SDK marker in built assets if present
code=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000/dashboard/proxy" || echo fail)
echo "local_/dashboard/proxy=$code"
if sudo docker exec proxyhubb-web-1 sh -c 'grep -Rql "SDK_MATRIX\|Integration Matrices\|pip install proxyhubb" /app/.next 2>/dev/null || grep -Rql "pip install proxyhubb" /app/app/.next 2>/dev/null'; then
  echo "BUNDLE_HAS_SDK_INSTALL"
else
  echo "WARN_BUNDLE_MARKER_NOT_FOUND"
fi

echo CONNECT_UI_DEPLOY_DONE
