#!/usr/bin/env bash
# Deploy light-theme web fixes to /opt/proxyhubb (emergency VM rebuild).
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
if [[ -f "$tmpdir/docker-compose.yml" ]]; then
  cp -a "$tmpdir/docker-compose.yml" "$PROJECT_DIR/docker-compose.yml"
fi
rm -rf "$tmpdir"

# Strip CRLF
find "$PROJECT_DIR/apps/web/src" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

# Sanity: light theme tokens present
grep -q 'surface-hover' "$PROJECT_DIR/apps/web/src/app/globals.css" \
  || { echo "globals.css missing surface-hover" >&2; exit 1; }
grep -q 'bg-card border-border' "$PROJECT_DIR/apps/web/src/components/ui/glass-card.tsx" \
  || { echo "GlassCard missing semantic surfaces" >&2; exit 1; }
grep -q 'border-border' "$PROJECT_DIR/apps/web/src/components/Sidebar.tsx" \
  || { echo "Sidebar missing border-border" >&2; exit 1; }
! grep -q 'border-white/5' "$PROJECT_DIR/apps/web/src/components/Sidebar.tsx" \
  || { echo "Sidebar still has border-white/5" >&2; exit 1; }

echo "Light theme foundation OK"

export ALLOW_EMERGENCY_WEB_BUILD=1
export PROJECT_DIR DOCKER
unset WEB_TAR
bash "$PROJECT_DIR/scripts/gcp-deploy-web-emergency-build.sh"
