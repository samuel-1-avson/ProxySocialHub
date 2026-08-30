#!/usr/bin/env bash
# Hotfix: map occupancy SQL uuid=text 500 + session list live Redis bytes.
# Never --remove-orphans. Never recreate edge-a.
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
CTR=proxyhubb-control-api-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-control-api:pre-map-fix-${STAMP}"
SRC="${MAP_FIX_SRC:-/tmp/map-fix}"

cd "$ROOT"
API_COMPOSE=(
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
)
[[ -f docker-compose.w6-host-a-private.yml ]] && API_COMPOSE+=( -f docker-compose.w6-host-a-private.yml )
[[ -f docker-compose.w10-observe.yml ]] && API_COMPOSE+=( -f docker-compose.w10-observe.yml )
[[ -f docker-compose.w10-listing-observe.yml ]] && API_COMPOSE+=( -f docker-compose.w10-listing-observe.yml )
[[ -f docker-compose.w11-enforce.yml ]] && API_COMPOSE+=( -f docker-compose.w11-enforce.yml )

echo "=== map occupancy SQL fix ==="
grep -q 'listing_id::text = pl.id::text' "$SRC/marketplace_geo.go"
grep -q 'Preload("Listing")' "$SRC/session.go"

EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
sudo docker tag proxyhubb-control-api "$TAG" || true
echo "rollback_tag=$TAG"

sudo mkdir -p "$ROOT/services/control-api/internal/api"
tr -d '\015' < "$SRC/marketplace_geo.go" | sudo tee "$ROOT/services/control-api/internal/api/marketplace_geo.go" >/dev/null
tr -d '\015' < "$SRC/session.go" | sudo tee "$ROOT/services/control-api/internal/api/session.go" >/dev/null
sudo sed -i 's/\r$//' "$ROOT/services/control-api/internal/api/marketplace_geo.go" "$ROOT/services/control-api/internal/api/session.go"
grep -q 'listing_id::text = pl.id::text' "$ROOT/services/control-api/internal/api/marketplace_geo.go"

sudo docker compose "${API_COMPOSE[@]}" build control-api
sudo docker compose "${API_COMPOSE[@]}" up -d --no-deps --force-recreate control-api

ok=0
for i in $(seq 1 40); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CTR" 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  if [[ "$st" == "healthy" ]]; then ok=1; break; fi
  sleep 3
done
[[ "$ok" == "1" ]] || { echo "FAIL: control-api not healthy"; sudo docker logs --tail 40 "$CTR"; exit 2; }
EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }

code=$(curl -sS -o /tmp/map-fix-body.json -w '%{http_code}' --max-time 30 \
  'http://127.0.0.1:18080/v1/marketplace/map?include_nodes=true&purchasable_only=true')
echo "map_http=$code"
[[ "$code" == "200" ]] || { echo "FAIL: map $code"; cat /tmp/map-fix-body.json; exit 2; }

echo MAP_FIX_OK
echo rollback_tag="$TAG"
