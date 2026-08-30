#!/usr/bin/env bash
# Occupancy + listing honesty roll: live active_sessions_count, concurrency cap,
# seller public profile fields, Hidden-until-session privacy labels.
# Never --remove-orphans. Never recreate edge-a.
#
# Upload payload to /tmp/occupancy-api/ then:
#   CONFIRM_OCCUPANCY_API=1 bash /tmp/occupancy-api/run.sh
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
CTR=proxyhubb-control-api-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-control-api:pre-occupancy-${STAMP}"
SRC="${OCCUPANCY_API_SRC:-/tmp/occupancy-api}"

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

echo "=== occupancy control-api deploy ==="
echo "root=$ROOT stamp=$STAMP confirm=${CONFIRM_OCCUPANCY_API:-}"

for f in docker-compose.yml docker-compose.testnet.yml docker-compose.gcp-testnet.yml; do
  [[ -f "$f" ]] || { echo "FAIL: missing overlay $f"; exit 2; }
done
[[ -d "$SRC/tree" ]] || { echo "FAIL: missing $SRC/tree"; exit 2; }
grep -q 'func CountActiveListingSessions' "$SRC/tree/internal/marketplace/listing_occupancy.go"
grep -q 'RefreshListingOccupancy' "$SRC/tree/internal/marketplace/session_activation.go"
grep -q 'enrichListingsOccupancy' "$SRC/tree/internal/api/listings.go"
grep -q 'ListingAtConcurrencyCap' "$SRC/tree/internal/api/orders.go"
grep -q 'Hidden until session' "$SRC/tree/internal/privacy/metadata.go"

echo "--- current image ---"
sudo docker inspect -f 'id={{.Image}} created={{.Created}} started={{.State.StartedAt}}' "$CTR"
EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
echo "edge-a started=$EDGE_A_STARTED_BEFORE"

slash_auto=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
slash_confirm=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
if [[ -n "${slash_auto:-}" || -n "${slash_confirm:-}" ]]; then
  echo "FAIL: slash dual-gate is set; abort"
  exit 2
fi

if [[ "${CONFIRM_OCCUPANCY_API:-}" != "1" ]]; then
  echo "INSPECT ONLY: set CONFIRM_OCCUPANCY_API=1 to sync, build, and swap"
  exit 0
fi

echo "--- tag previous image ---"
sudo docker tag proxyhubb-control-api "$TAG"
echo "rollback_tag=$TAG"

echo "--- sync source ---"
sudo mkdir -p \
  "$ROOT/services/control-api/internal/marketplace" \
  "$ROOT/services/control-api/internal/api" \
  "$ROOT/services/control-api/internal/privacy" \
  "$ROOT/services/control-api/internal/core/domain" \
  "$ROOT/services/control-api/internal/db"

sync_file() {
  local rel="$1"
  tr -d '\015' < "$SRC/tree/$rel" | sudo tee "$ROOT/services/control-api/$rel" >/dev/null
  sudo sed -i 's/\r$//' "$ROOT/services/control-api/$rel"
}

sync_file internal/marketplace/listing_occupancy.go
sync_file internal/marketplace/session_activation.go
sync_file internal/api/listing_occupancy.go
sync_file internal/api/listings.go
sync_file internal/api/listings_catalog.go
sync_file internal/api/orders.go
sync_file internal/api/session.go
sync_file internal/api/marketplace_geo.go
sync_file internal/privacy/metadata.go
sync_file internal/core/domain/marketplace.go
sync_file internal/db/listing_read_repository.go

grep -q 'func CountActiveListingSessions' "$ROOT/services/control-api/internal/marketplace/listing_occupancy.go"
grep -q 'Hidden until session' "$ROOT/services/control-api/internal/privacy/metadata.go"

echo "--- build ---"
sudo docker compose "${API_COMPOSE[@]}" build control-api

echo "--- swap control-api only (no --remove-orphans, no edges) ---"
sudo docker compose "${API_COMPOSE[@]}" up -d --no-deps --force-recreate control-api

echo "--- wait healthy ---"
ok=0
for i in $(seq 1 40); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CTR" 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  if [[ "$st" == "healthy" ]]; then
    ok=1
    break
  fi
  sleep 3
done
[[ "$ok" == "1" ]] || { echo "FAIL: control-api not healthy"; sudo docker logs --tail 80 "$CTR" || true; exit 2; }

echo "--- verify ---"
EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }

curl -fsS --max-time 10 http://127.0.0.1:18080/health >/dev/null
sudo docker exec "$CTR" sh -c '/server -h >/dev/null 2>&1 || true'
if sudo docker exec "$CTR" sh -c "grep -aqs 'Hidden until session' /server || grep -aqs 'CountActiveListingSessions' /server || true"; then
  echo "binary strings: occupancy/privacy present-or-stripped (ok if stripped)"
fi

echo OCCUPANCY_API_OK
echo rollback_tag="$TAG"
