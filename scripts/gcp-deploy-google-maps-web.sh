#!/usr/bin/env bash
# Deploy Google Maps web changes to /opt/proxyhubb (emergency VM rebuild).
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

# Strip CRLF from synced TS/TSX (Windows hosts)
find "$PROJECT_DIR/apps/web/src/components/map" \
  "$PROJECT_DIR/apps/web/src/app/marketplace/map" \
  "$PROJECT_DIR/apps/web/src/app/marketplace/create" \
  -type f \( -name '*.ts' -o -name '*.tsx' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

# Prefer GCP Secret Manager / API Keys as source of truth for Maps JS key
if [[ -x "$PROJECT_DIR/scripts/gcp-sync-google-maps-key.sh" ]] || [[ -f "$PROJECT_DIR/scripts/gcp-sync-google-maps-key.sh" ]]; then
  echo "Syncing Google Maps API key from GCP…"
  PROJECT_DIR="$PROJECT_DIR" bash "$PROJECT_DIR/scripts/gcp-sync-google-maps-key.sh" \
    || echo "WARN: GCP Maps key sync failed; falling back to existing .env" >&2
fi

if ! grep -qE '^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=.+' "$PROJECT_DIR/.env"; then
  echo "ERROR: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set in $PROJECT_DIR/.env" >&2
  echo "Run: PROJECT_DIR=$PROJECT_DIR bash scripts/gcp-sync-google-maps-key.sh" >&2
  exit 1
fi

# Confirm Dockerfile + compose wire the build arg (presence only)
grep -q 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY' "$PROJECT_DIR/apps/web/Dockerfile" \
  || { echo "Dockerfile missing GOOGLE_MAPS ARG" >&2; exit 1; }
grep -q 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY' "$PROJECT_DIR/docker-compose.yml" \
  || { echo "compose missing GOOGLE_MAPS build arg" >&2; exit 1; }
test -f "$PROJECT_DIR/apps/web/src/components/map/GoogleProxyMapCanvas.tsx" \
  || { echo "GoogleProxyMapCanvas.tsx missing after extract" >&2; exit 1; }
grep -q '@react-google-maps/api' "$PROJECT_DIR/apps/web/package.json" \
  || { echo "package.json missing @react-google-maps/api" >&2; exit 1; }

echo "GOOGLE_MAPS_KEY=present"
if grep -qE '^NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=.+' "$PROJECT_DIR/.env"; then
  echo "GOOGLE_MAPS_MAP_ID=present (vector + Advanced Markers)"
else
  echo "GOOGLE_MAPS_MAP_ID=unset — run gcp-sync or set Map ID from GCP Map Management"
fi
echo "Google canvas + compose/Dockerfile wiring OK"

export ALLOW_EMERGENCY_WEB_BUILD=1
export PROJECT_DIR DOCKER
# Do not pass WEB_TAR again — already extracted
unset WEB_TAR
bash "$PROJECT_DIR/scripts/gcp-deploy-web-emergency-build.sh"
