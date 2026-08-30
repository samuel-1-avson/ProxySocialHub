#!/usr/bin/env bash
# Micro-GiB escrow settle (no 0.107→1 GiB ceil). Never --remove-orphans. Never recreate edge-a.
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
CTR=proxyhubb-control-api-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-control-api:pre-escrow-units-${STAMP}"
SRC="${ESCROW_UNITS_API_SRC:-/tmp/escrow-units-api}"
cd "$ROOT"
API_COMPOSE=(-f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
[[ -f docker-compose.w6-host-a-private.yml ]] && API_COMPOSE+=(-f docker-compose.w6-host-a-private.yml)
[[ -f docker-compose.w10-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-observe.yml)
[[ -f docker-compose.w10-listing-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-listing-observe.yml)
[[ -f docker-compose.w11-enforce.yml ]] && API_COMPOSE+=(-f docker-compose.w11-enforce.yml)

grep -q 'EscrowUnitsPerGiB' "$SRC/escrow_units.go"
grep -q 'SettleOrderEscrowConsumedBytes' "$SRC/escrow_settle.go"
grep -q 'EnqueueEscrowSettleBytes' "$SRC/compensation_outbox.go"
grep -q 'EnqueueEscrowSettleBytes' "$SRC/usage.go"
grep -q 'escrow_bandwidth_units' "$SRC/orders.go"
grep -q 'quality_score, 0' "$SRC/marketplace_geo.go"

EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
sudo docker tag proxyhubb-control-api "$TAG" || true

sync_one() {
  local src="$1" dest="$2"
  tr -d '\015' < "$src" | sudo tee "$dest" >/dev/null
  sudo sed -i 's/\r$//' "$dest"
}

sync_one "$SRC/escrow_units.go" "$ROOT/services/control-api/internal/solana/escrow_units.go"
sync_one "$SRC/escrow_settle.go" "$ROOT/services/control-api/internal/api/escrow_settle.go"
sync_one "$SRC/compensation_outbox.go" "$ROOT/services/control-api/internal/api/compensation_outbox.go"
sync_one "$SRC/usage.go" "$ROOT/services/control-api/internal/api/usage.go"
sync_one "$SRC/session.go" "$ROOT/services/control-api/internal/api/session.go"
sync_one "$SRC/orders.go" "$ROOT/services/control-api/internal/api/orders.go"
sync_one "$SRC/dispute_jury.go" "$ROOT/services/control-api/internal/api/dispute_jury.go"
sync_one "$SRC/marketplace_geo.go" "$ROOT/services/control-api/internal/api/marketplace_geo.go"

sudo docker compose "${API_COMPOSE[@]}" build control-api
sudo docker compose "${API_COMPOSE[@]}" up -d --no-deps --force-recreate control-api
ok=0
for i in $(seq 1 40); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CTR" 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  if [[ "$st" == "healthy" ]]; then ok=1; break; fi
  sleep 3
done
[[ "$ok" == "1" ]] || { echo "FAIL: control-api not healthy"; sudo docker logs --tail 80 "$CTR" || true; exit 2; }
EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }
echo ESCROW_UNITS_API_OK
echo rollback_tag="$TAG"
