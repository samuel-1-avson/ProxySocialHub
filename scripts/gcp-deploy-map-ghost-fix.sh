#!/usr/bin/env bash
# Deploy marketplace map ghost-node fix (control-api + web).
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?Set DEPLOY_TAR to the uploaded tarball}"
DOCKER="${DOCKER:-docker}"

cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extracting $DEPLOY_TAR"
tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"

if [[ -d "$tmpdir/control-api" ]]; then
  mkdir -p "$PROJECT_DIR/services/control-api"
  cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
fi
if [[ -d "$tmpdir/web" ]]; then
  mkdir -p "$PROJECT_DIR/apps/web"
  cp -a "$tmpdir/web/." "$PROJECT_DIR/apps/web/"
fi
rm -rf "$tmpdir"

find "$PROJECT_DIR/services/control-api/internal/api" \
  "$PROJECT_DIR/services/control-api/internal/indexer" \
  "$PROJECT_DIR/apps/web/src/app/marketplace/map" \
  "$PROJECT_DIR/apps/web/src/components/network" \
  -type f \( -name '*.go' -o -name '*.tsx' -o -name '*.ts' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

grep -q 'Never plot footprints for soft-deleted provider nodes' \
  "$PROJECT_DIR/services/control-api/internal/api/marketplace_geo.go"
grep -q 'failed to delete explorer_nodes footprint' \
  "$PROJECT_DIR/services/control-api/internal/api/provider_nodes.go"
grep -q 'Drop map footprints for soft-deleted provider nodes' \
  "$PROJECT_DIR/services/control-api/internal/indexer/node_sync.go"
grep -q 'active_nodes_only: true' \
  "$PROJECT_DIR/apps/web/src/app/marketplace/map/page.tsx"
grep -q 'active_nodes_only: true' \
  "$PROJECT_DIR/apps/web/src/components/network/NetworkMapEmbed.tsx"
echo HAS_MAP_GHOST_FIX

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building control-api"
"${COMPOSE[@]}" build control-api

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Recreating control-api"
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

ok=0
for i in $(seq 1 120); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' 2>/dev/null || true)
  echo "try=$i control-api $st"
  if echo "$st" | grep -qi healthy; then
    echo control-api HEALTHY
    ok=1
    break
  fi
  sleep 5
done
[[ "$ok" -eq 1 ]] || { echo "control-api not healthy" >&2; exit 1; }

export ALLOW_EMERGENCY_WEB_BUILD=1
export PROJECT_DIR DOCKER
unset DEPLOY_TAR WEB_TAR
bash "$PROJECT_DIR/scripts/gcp-deploy-web-emergency-build.sh"

# Clear map cache after roll
if sudo docker exec proxyhubb-redis-1 redis-cli --raw KEYS 'marketplace:map:*' >/tmp/map-keys.txt 2>/dev/null; then
  while IFS= read -r k; do
    [ -n "$k" ] && sudo docker exec proxyhubb-redis-1 redis-cli DEL "$k" >/dev/null || true
  done < /tmp/map-keys.txt
fi

code=$(curl -sS -o /tmp/map.json -w '%{http_code}' 'http://127.0.0.1:8080/v1/marketplace/map?include_nodes=true' || echo fail)
echo "map_http=$code"
python3 -c 'import json; d=json.load(open("/tmp/map.json")); print("node_count", d.get("node_count"), "listing_count", d.get("listing_count"))' || true

# Verify binary contains new delete hygiene string
if sudo docker exec proxyhubb-control-api-1 sh -c 'strings /app/control-api 2>/dev/null | grep -q "explorer_nodes footprint"'; then
  echo BUNDLE_HAS_DELETE_FOOTPRINT_FIX
else
  echo WARN_BUNDLE_MARKER_NOT_FOUND
fi

echo MAP_GHOST_DEPLOY_DONE
