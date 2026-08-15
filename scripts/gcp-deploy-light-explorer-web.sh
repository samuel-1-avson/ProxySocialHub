#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
WEB_TAR="${WEB_TAR:?Set WEB_TAR}"
DOCKER="${DOCKER:-docker}"
cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extracting $WEB_TAR"
tmpdir=$(mktemp -d)
tar -xzf "$WEB_TAR" -C "$tmpdir"
cp -a "$tmpdir/web/." "$PROJECT_DIR/apps/web/"
rm -rf "$tmpdir"
find "$PROJECT_DIR/apps/web/src/app/explorer" \
  "$PROJECT_DIR/apps/web/src/app/dashboard/provider/cli" \
  "$PROJECT_DIR/apps/web/src/app/community/feed" \
  "$PROJECT_DIR/apps/web/src/components" \
  -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true
! grep -qE 'text-white/(10|20|30|40)' "$PROJECT_DIR/apps/web/src/app/explorer/page.tsx" \
  || { echo "explorer overview still has faint text-white opacity" >&2; exit 1; }
grep -q 'border-border' "$PROJECT_DIR/apps/web/src/app/explorer/map/page.tsx" \
  || { echo "explorer map missing border-border" >&2; exit 1; }
echo "Explorer light-theme OK"
export ALLOW_EMERGENCY_WEB_BUILD=1 PROJECT_DIR DOCKER
unset WEB_TAR
bash "$PROJECT_DIR/scripts/gcp-deploy-web-emergency-build.sh"
