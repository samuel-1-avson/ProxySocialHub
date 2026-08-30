#!/usr/bin/env bash
# Host-A control-api recreate while W11.A enforce overlays stay last.
# Does not recreate edge-a or edge-b. Never --remove-orphans. Never slash gates.
#
#   CONFIRM_HOST_A_ROLL=1 bash /tmp/gcp-host-a-control-api-roll-enforce.sh
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
CTR=proxyhubb-control-api-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-control-api:pre-roll-${STAMP}"
SRC="${ROLL_SRC:-/tmp/host-a-control-api-roll}"

cd "$ROOT"
API_COMPOSE=(
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
  -f docker-compose.w6-host-a-private.yml
  -f docker-compose.w10-observe.yml
  -f docker-compose.w10-listing-observe.yml
  -f docker-compose.w11-enforce.yml
)

echo "=== Host-A control-api roll (keep enforce) ==="
echo "root=$ROOT stamp=$STAMP confirm=${CONFIRM_HOST_A_ROLL:-}"

for f in docker-compose.yml docker-compose.testnet.yml docker-compose.gcp-testnet.yml \
  docker-compose.w6-host-a-private.yml docker-compose.w10-observe.yml \
  docker-compose.w10-listing-observe.yml docker-compose.w11-enforce.yml; do
  [[ -f "$f" ]] || { echo "FAIL: missing overlay $f"; exit 2; }
done

echo "--- current image ---"
sudo docker inspect -f 'id={{.Image}} created={{.Created}} started={{.State.StartedAt}}' "$CTR"
EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
echo "edge-a started=$EDGE_A_STARTED_BEFORE"

echo "--- current env ---"
for k in PROXYHUB_SESSION_CAPABILITY PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT PROXYHUB_LISTING_COMMITMENT GATEWAY_OP_A_HOST_ID GATEWAY_OP_B_HOST_ID PROXYHUB_GATEWAY_SLASH_AUTO PROXYHUB_GATEWAY_SLASH_CONFIRM AUTO_MIGRATE; do
  v=$(sudo docker exec "$CTR" printenv "$k" 2>/dev/null || echo unset)
  echo "$k=$v"
done

cap=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY 2>/dev/null | tr -d '\r' || echo unset)
mint=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT 2>/dev/null | tr -d '\r' || echo unset)
listing=$(sudo docker exec "$CTR" printenv PROXYHUB_LISTING_COMMITMENT 2>/dev/null | tr -d '\r' || echo unset)
[[ "$cap" == "enforce" ]] || { echo "FAIL: live capability is '$cap' not enforce; abort"; exit 2; }
[[ "$mint" == "enforce" ]] || { echo "FAIL: live operator mint is '$mint' not enforce; abort"; exit 2; }
[[ "$listing" == "observe" ]] || { echo "FAIL: listing is '$listing' not observe; abort"; exit 2; }

slash_auto=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
slash_confirm=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
if [[ -n "${slash_auto:-}" || -n "${slash_confirm:-}" ]]; then
  echo "FAIL: slash dual-gate is set; abort"
  exit 2
fi

if [[ "${CONFIRM_HOST_A_ROLL:-}" != "1" ]]; then
  echo "INSPECT ONLY: set CONFIRM_HOST_A_ROLL=1 to sync, migrate, build, and swap"
  exit 0
fi

[[ -d "$SRC/services/control-api" ]] || { echo "FAIL: missing $SRC/services/control-api"; exit 2; }
[[ -d "$SRC/migrations" ]] || { echo "FAIL: missing $SRC/migrations"; exit 2; }
[[ -f "$SRC/migrations/000152_extension_devices.up.sql" ]] || { echo "FAIL: missing 000152"; exit 2; }
grep -q 'publishedBuyerAuthHMAC' "$SRC/services/control-api/internal/api/orders.go"
grep -q 'RegisterExtensionPublicRoutes' "$SRC/services/control-api/main.go"
grep -q 'listing commitment registered on-chain' "$SRC/services/control-api/internal/api/listing_commitment_sync.go"

echo "--- tag previous image ---"
sudo docker tag proxyhubb-control-api "$TAG"
echo "rollback_tag=$TAG"

echo "--- sync source (control-api + migrations + enforce overlay) ---"
find "$SRC/services/control-api" -maxdepth 1 \( -name '.env' -o -name '.env.local' -o -name '.host-attempt' \) -delete
sudo mkdir -p "$ROOT/services/control-api" "$ROOT/migrations"
sudo cp -a "$SRC/services/control-api/." "$ROOT/services/control-api/"
sudo cp -a "$SRC/migrations/." "$ROOT/migrations/"
if [[ -f "$SRC/docker-compose.w11-enforce.yml" ]]; then
  sudo cp -a "$SRC/docker-compose.w11-enforce.yml" "$ROOT/docker-compose.w11-enforce.yml"
fi
find "$ROOT/services/control-api" "$ROOT/migrations" -type f \
  \( -name '*.go' -o -name '*.yml' -o -name '*.sql' -o -name 'Dockerfile' -o -name 'go.mod' -o -name 'go.sum' \) \
  -print0 | xargs -0 -r sudo sed -i 's/\r$//' || true

echo "--- db-migrate (000152 extension devices) ---"
sudo docker compose "${API_COMPOSE[@]}" run --rm --no-deps db-migrate

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

echo "--- verify env ---"
cap2=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY | tr -d '\r')
mint2=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT | tr -d '\r')
listing2=$(sudo docker exec "$CTR" printenv PROXYHUB_LISTING_COMMITMENT | tr -d '\r')
hid_a=$(sudo docker exec "$CTR" printenv GATEWAY_OP_A_HOST_ID | tr -d '\r')
hid_b=$(sudo docker exec "$CTR" printenv GATEWAY_OP_B_HOST_ID | tr -d '\r')
echo "PROXYHUB_SESSION_CAPABILITY=$cap2"
echo "PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT=$mint2"
echo "PROXYHUB_LISTING_COMMITMENT=$listing2"
echo "GATEWAY_OP_A_HOST_ID=$hid_a"
echo "GATEWAY_OP_B_HOST_ID=$hid_b"
[[ "$cap2" == "enforce" ]] || { echo "FAIL: capability flipped to $cap2"; exit 2; }
[[ "$mint2" == "enforce" ]] || { echo "FAIL: mint flipped to $mint2"; exit 2; }
[[ "$listing2" == "observe" ]] || { echo "FAIL: listing dropped to $listing2"; exit 2; }
[[ "$hid_a" == "gce-proxyhubb-testnet" ]] || { echo "FAIL: GATEWAY_OP_A_HOST_ID=$hid_a"; exit 2; }
[[ "$hid_b" == "gce-w6-operator-b" ]] || { echo "FAIL: GATEWAY_OP_B_HOST_ID=$hid_b"; exit 2; }

slash_auto2=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
slash_confirm2=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
if [[ -n "${slash_auto2:-}" || -n "${slash_confirm2:-}" ]]; then
  echo "FAIL: slash dual-gate appeared after swap"
  exit 2
fi

EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }

curl -fsS http://127.0.0.1:18080/health
echo
pair=$(curl -sS -o /tmp/pair-finish.body -w '%{http_code}' -X POST http://127.0.0.1:18080/v1/extension/pair/finish -H 'Content-Type: application/json' -d '{}')
echo "pair_finish_status=$pair"
[[ "$pair" != "404" ]] || { echo "FAIL: pair/finish still 404"; exit 2; }

sudo docker exec "$CTR" sh -c 'grep -a -c "pair from the website session, not the extension token" /server; grep -a -c "auth_for_endpoint" /server'

echo HOST_A_CONTROL_API_ROLL_OK
echo rollback_tag="$TAG"
echo HMAC_CONTROL_GROUP_INTACT
