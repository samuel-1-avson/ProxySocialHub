#!/usr/bin/env bash
# Host-A control-api roll — bring the running binary up to the repo.
# Keep W10.A observe. Do not flip listing commitment, operator mint, or slash.
# Never --remove-orphans (J2 edges / redis-ha look like orphans).
#
#   bash /tmp/gcp-host-a-control-api-roll.sh                 # inspect
#   CONFIRM_HOST_A_ROLL=1 bash /tmp/gcp-host-a-control-api-roll.sh
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
CTR=proxyhubb-control-api-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d)}"
TAG="proxyhubb-control-api:pre-roll-${STAMP}"
SRC="${ROLL_SRC:-/tmp/host-a-control-api-roll}"

cd "$ROOT"
COMPOSE=( -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.w6-host-a-private.yml -f docker-compose.w10-observe.yml )
if [[ -f docker-compose.w10-listing-observe.yml ]]; then
  COMPOSE+=( -f docker-compose.w10-listing-observe.yml )
fi

echo "=== Host-A control-api roll ==="
echo "root=$ROOT stamp=$STAMP confirm=${CONFIRM_HOST_A_ROLL:-}"

for f in docker-compose.yml docker-compose.testnet.yml docker-compose.gcp-testnet.yml docker-compose.w6-host-a-private.yml docker-compose.w10-observe.yml; do
  [[ -f "$f" ]] || { echo "FAIL: missing overlay $f"; exit 2; }
done

echo "--- current image ---"
sudo docker inspect -f 'id={{.Image}} created={{.Created}} name={{.Name}}' "$CTR"

echo "--- current env (must stay observe / host ids / slash unset) ---"
for k in PROXYHUB_SESSION_CAPABILITY PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT PROXYHUB_LISTING_COMMITMENT GATEWAY_OP_A_HOST_ID GATEWAY_OP_B_HOST_ID PROXYHUB_GATEWAY_SLASH_AUTO PROXYHUB_GATEWAY_SLASH_CONFIRM PROXYHUB_OPERATOR_BUNDLE_PATH; do
  v=$(sudo docker exec "$CTR" printenv "$k" 2>/dev/null || echo unset)
  echo "$k=$v"
done

cap=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY 2>/dev/null || echo unset)
[[ "$cap" == "observe" ]] || { echo "FAIL: live capability is '$cap' not observe; abort"; exit 2; }

slash_auto=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
slash_confirm=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
if [[ -n "${slash_auto:-}" || -n "${slash_confirm:-}" ]]; then
  echo "FAIL: slash dual-gate is set; abort"
  exit 2
fi

if [[ "${CONFIRM_HOST_A_ROLL:-}" != "1" ]]; then
  echo "INSPECT ONLY: set CONFIRM_HOST_A_ROLL=1 to sync, build, and swap"
  exit 0
fi

[[ -d "$SRC/services/control-api" ]] || { echo "FAIL: missing $SRC/services/control-api"; exit 2; }
[[ -d "$SRC/migrations" ]] || { echo "FAIL: missing $SRC/migrations"; exit 2; }
grep -q 'listing commitment registered on-chain' "$SRC/services/control-api/internal/api/listing_commitment_sync.go"
grep -q 'operators_and_control_api' "$SRC/services/control-api/internal/decentralization/mode.go"
grep -q 'bonded_gateway_program' "$SRC/services/control-api/internal/gateways/manifest.go"
grep -q 'GetOraclePublicKey()' "$SRC/services/control-api/internal/solana/listing_commitment.go"

echo "--- tag previous image ---"
sudo docker tag proxyhubb-control-api "$TAG"
echo "rollback_tag=$TAG"

echo "--- sync source (control-api + migrations) ---"
# Never copy laptop secrets into the VM tree or the build context.
find "$SRC/services/control-api" -maxdepth 1 \( -name '.env' -o -name '.env.local' -o -name '.host-attempt' \) -delete
sudo mkdir -p "$ROOT/services/control-api" "$ROOT/migrations"
sudo cp -a "$SRC/services/control-api/." "$ROOT/services/control-api/"
sudo cp -a "$SRC/migrations/." "$ROOT/migrations/"
if [[ -f "$SRC/docker-compose.w6-host-a-private.yml" ]]; then
  sudo cp -a "$SRC/docker-compose.w6-host-a-private.yml" "$ROOT/docker-compose.w6-host-a-private.yml"
fi
if [[ -f "$SRC/docker-compose.w10-observe.yml" ]]; then
  sudo cp -a "$SRC/docker-compose.w10-observe.yml" "$ROOT/docker-compose.w10-observe.yml"
fi
if [[ -f "$SRC/docker-compose.w10-listing-observe.yml" ]]; then
  sudo cp -a "$SRC/docker-compose.w10-listing-observe.yml" "$ROOT/docker-compose.w10-listing-observe.yml"
fi
find "$ROOT/services/control-api" "$ROOT/migrations" -type f \
  \( -name '*.go' -o -name '*.yml' -o -name '*.sql' -o -name 'Dockerfile' -o -name 'go.mod' -o -name 'go.sum' \) \
  -print0 | xargs -0 -r sudo sed -i 's/\r$//' || true

echo "--- build ---"
sudo docker compose "${COMPOSE[@]}" build control-api

echo "--- swap (no --remove-orphans) ---"
sudo docker compose "${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

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
[[ "$ok" == "1" ]] || { echo "FAIL: control-api not healthy"; exit 2; }

echo "--- verify env ---"
cap2=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY)
hid_a=$(sudo docker exec "$CTR" printenv GATEWAY_OP_A_HOST_ID)
hid_b=$(sudo docker exec "$CTR" printenv GATEWAY_OP_B_HOST_ID)
echo "PROXYHUB_SESSION_CAPABILITY=$cap2"
echo "GATEWAY_OP_A_HOST_ID=$hid_a"
echo "GATEWAY_OP_B_HOST_ID=$hid_b"
[[ "$cap2" == "observe" ]] || { echo "FAIL: capability flipped to $cap2"; exit 2; }
[[ "$hid_a" == "gce-proxyhubb-testnet" ]] || { echo "FAIL: GATEWAY_OP_A_HOST_ID=$hid_a"; exit 2; }
[[ "$hid_b" == "gce-w6-operator-b" ]] || { echo "FAIL: GATEWAY_OP_B_HOST_ID=$hid_b"; exit 2; }

curl -fsS http://127.0.0.1:18080/health
echo

if [[ -x /tmp/gcp-host-a-control-api-drift-probe.sh ]]; then
  bash /tmp/gcp-host-a-control-api-drift-probe.sh
fi

echo HOST_A_CONTROL_API_ROLL_OK
echo rollback_tag="$TAG"
