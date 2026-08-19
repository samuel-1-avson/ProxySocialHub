#!/usr/bin/env bash
# Copy one Go file and rebuild Host-A control-api. Keep observe + listing observe.
# Never --remove-orphans.
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
SRC="${1:-/tmp/listing_commitment_sync.go}"
[[ -f "$SRC" ]] || { echo "FAIL: missing $SRC"; exit 2; }
grep -q 'listing commitment: register retry' "$SRC"
sudo mkdir -p "$ROOT/services/control-api/internal/api"
tr -d '\015' < "$SRC" | sudo tee "$ROOT/services/control-api/internal/api/listing_commitment_sync.go" >/dev/null
cd "$ROOT"
COMPOSE=( -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.w6-host-a-private.yml -f docker-compose.w10-observe.yml )
if [[ -f docker-compose.w10-listing-observe.yml ]]; then
  COMPOSE+=( -f docker-compose.w10-listing-observe.yml )
fi
cap=$(sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_SESSION_CAPABILITY)
[[ "$cap" == "observe" ]] || { echo "FAIL: capability $cap"; exit 2; }
slash_auto=$(sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
slash_confirm=$(sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
if [[ -n "${slash_auto:-}" || -n "${slash_confirm:-}" ]]; then
  echo "FAIL: slash dual-gate is set"; exit 2
fi
sudo docker compose "${COMPOSE[@]}" build control-api
sudo docker compose "${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
ok=0
for i in $(seq 1 40); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-control-api-1)
  echo "try=$i health=$st"
  [[ "$st" == "healthy" ]] && { ok=1; break; }
  sleep 3
done
[[ "$ok" == "1" ]] || { echo "FAIL: not healthy"; exit 2; }
sudo docker exec proxyhubb-control-api-1 sh -c 'grep -a -c "listing commitment: register retry" /server'
echo LISTING_SYNC_RETRY_ROLL_OK
