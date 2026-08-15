#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
WEB_TAR="${WEB_TAR:?Set WEB_TAR}"
DOCKER="${DOCKER:-docker}"
cd "$PROJECT_DIR"
tmpdir=$(mktemp -d)
tar -xzf "$WEB_TAR" -C "$tmpdir"
cp -a "$tmpdir/web/." "$PROJECT_DIR/apps/web/"
rm -rf "$tmpdir"
find "$PROJECT_DIR/apps/web/src/app/dashboard/provider" "$PROJECT_DIR/apps/web/src/lib/api" \
  -type f \( -name '*.ts' -o -name '*.tsx' \) -exec sed -i 's/\r$//' {} + 2>/dev/null || true
grep -q 'createProviderServiceConfig' "$PROJECT_DIR/apps/web/src/lib/api/provider.ts"
grep -q 'CircleBrowseModal' "$PROJECT_DIR/apps/web/src/app/dashboard/provider/circle/page.tsx"
grep -q 'getNodeUptime' "$PROJECT_DIR/apps/web/src/app/dashboard/provider/analytics/page.tsx"
echo PROVIDER_PARTIALS_OK
export ALLOW_EMERGENCY_WEB_BUILD=1 PROJECT_DIR DOCKER
unset WEB_TAR
bash "$PROJECT_DIR/scripts/gcp-deploy-web-emergency-build.sh"
