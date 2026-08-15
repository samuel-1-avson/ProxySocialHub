#!/usr/bin/env bash
# Deploy explorer globe pin visibility + dead/deleted node filtering.
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
if [[ -f "$tmpdir/scripts/gcp-deploy-map-globe-dead.sh" ]]; then
  cp -a "$tmpdir/scripts/gcp-deploy-map-globe-dead.sh" "$PROJECT_DIR/scripts/gcp-deploy-map-globe-dead.sh"
fi
rm -rf "$tmpdir"

find "$PROJECT_DIR/services/control-api/internal/api" \
  "$PROJECT_DIR/apps/web/src/app/explorer/map" \
  "$PROJECT_DIR/apps/web/src/components/map" \
  -type f \( -name '*.go' -o -name '*.tsx' -o -name '*.ts' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

grep -q '14 days' \
  "$PROJECT_DIR/services/control-api/internal/api/marketplace_geo.go"
grep -q 'plottedFocusKey' \
  "$PROJECT_DIR/apps/web/src/app/explorer/map/globe/GlobeScene.tsx"
grep -q 'useState(true)' \
  "$PROJECT_DIR/apps/web/src/app/explorer/map/page.tsx"
echo HAS_MAP_GLOBE_DEAD_FIX

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
echo "map_all_http=$code"
code2=$(curl -sS -o /tmp/map-active.json -w '%{http_code}' 'http://127.0.0.1:8080/v1/marketplace/map?include_nodes=true&active_nodes_only=true' || echo fail)
echo "map_active_http=$code2"
python3 - <<'PY'
import json
for name in ("map.json", "map-active.json"):
    d=json.load(open("/tmp/"+name))
    print(name, "node_count", d.get("node_count"), "listing_count", d.get("listing_count"), "total", d.get("total"))
    for p in (d.get("points") or [])[:5]:
        print(" ", p.get("kind"), p.get("status"), p.get("country"), p.get("lat"), p.get("lon"))
PY

echo MAP_GLOBE_DEAD_DEPLOY_DONE
