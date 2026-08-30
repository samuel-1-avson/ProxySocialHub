#!/usr/bin/env bash
# Micro-GiB initializeEscrow + unmeasured SLA labels. Never --remove-orphans.
# Never recreate edge-a or control-api.
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
WEB_CTR=proxyhubb-web-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-web:pre-escrow-units-${STAMP}"
SRC="${ESCROW_UNITS_WEB_SRC:-/tmp/escrow-units-web}"
cd "$ROOT"
API_COMPOSE=(-f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
[[ -f docker-compose.w6-host-a-private.yml ]] && API_COMPOSE+=(-f docker-compose.w6-host-a-private.yml)
[[ -f docker-compose.w10-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-observe.yml)
[[ -f docker-compose.w10-listing-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-listing-observe.yml)
[[ -f docker-compose.w11-enforce.yml ]] && API_COMPOSE+=(-f docker-compose.w11-enforce.yml)

grep -q 'ESCROW_UNITS_PER_GIB' "$SRC/solana.ts"
grep -q 'escrowBandwidthUnitsFromGiB' "$SRC/solana.ts"
grep -q 'escrow_bandwidth_units' "$SRC/marketplace.ts"
grep -q 'Unmeasured' "$SRC/ListingSlaBadge.tsx"

EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
API_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
sudo docker tag proxyhubb-web "$TAG" || true

sync_one() {
  local src="$1" dest="$2"
  tr -d '\015' < "$src" | sudo tee "$dest" >/dev/null
  sudo sed -i 's/\r$//' "$dest"
}

sync_one "$SRC/solana.ts" "$ROOT/apps/web/src/lib/solana.ts"
sync_one "$SRC/marketplace.ts" "$ROOT/apps/web/src/lib/api/marketplace.ts"
sync_one "$SRC/market.ts" "$ROOT/apps/web/src/lib/services/market.ts"
sync_one "$SRC/ListingSlaBadge.tsx" "$ROOT/apps/web/src/components/marketplace/ListingSlaBadge.tsx"
sync_one "$SRC/map-page.tsx" "$ROOT/apps/web/src/app/marketplace/map/page.tsx"

sudo docker compose "${API_COMPOSE[@]}" build web
sudo docker compose "${API_COMPOSE[@]}" up -d --no-deps --force-recreate web
ok=0
for i in $(seq 1 60); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$WEB_CTR" 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  if [[ "$st" == "healthy" ]]; then ok=1; break; fi
  sleep 3
done
[[ "$ok" == "1" ]] || { echo "FAIL: web not healthy"; sudo docker logs --tail 80 "$WEB_CTR" || true; exit 2; }
EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }
API_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
[[ "$API_STARTED_BEFORE" == "$API_STARTED_AFTER" ]] || { echo "FAIL: control-api was recreated"; exit 2; }
echo ESCROW_UNITS_WEB_OK
echo rollback_tag="$TAG"
