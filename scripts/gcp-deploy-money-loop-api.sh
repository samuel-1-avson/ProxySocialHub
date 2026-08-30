#!/usr/bin/env bash
# Close the shop money loop: earnings via node mirror, settle outbox on RPC
# quota, usage history, public RPC fallback. Never --remove-orphans. Never recreate edge-a.
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
CTR=proxyhubb-control-api-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-control-api:pre-money-loop-${STAMP}"
SRC="${MONEY_LOOP_API_SRC:-/tmp/money-loop-api}"
cd "$ROOT"
API_COMPOSE=(-f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
[[ -f docker-compose.w6-host-a-private.yml ]] && API_COMPOSE+=(-f docker-compose.w6-host-a-private.yml)
[[ -f docker-compose.w10-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-observe.yml)
[[ -f docker-compose.w10-listing-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-listing-observe.yml)
[[ -f docker-compose.w11-enforce.yml ]] && API_COMPOSE+=(-f docker-compose.w11-enforce.yml)

grep -q 'ResolveProviderNodeForSession' "$SRC/provider_node.go"
grep -q 'recordProviderEarning: could not resolve' "$SRC/provider_earnings.go"
grep -q 'orderHasSettleTx' "$SRC/compensation_outbox.go"
grep -q 'anchor_and_settle.proof_rpc_fail' "$SRC/usage.go"
grep -q 'ensurePublicDevnetFallback' "$SRC/rpc_endpoint.go"
grep -q 'isIndexerRPCQuotaError' "$SRC/blockchain_indexer.go"

EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
sudo docker tag proxyhubb-control-api "$TAG" || true

sync_one() {
  local src="$1" dest="$2"
  tr -d '\015' < "$src" | sudo tee "$dest" >/dev/null
  sudo sed -i 's/\r$//' "$dest"
}

sync_one "$SRC/provider_node.go" "$ROOT/services/control-api/internal/marketplace/provider_node.go"
sync_one "$SRC/provider_earnings.go" "$ROOT/services/control-api/internal/api/provider_earnings.go"
sync_one "$SRC/compensation_outbox.go" "$ROOT/services/control-api/internal/api/compensation_outbox.go"
sync_one "$SRC/usage.go" "$ROOT/services/control-api/internal/api/usage.go"
sync_one "$SRC/analytics.go" "$ROOT/services/control-api/internal/api/analytics.go"
sync_one "$SRC/client.go" "$ROOT/services/control-api/internal/solana/client.go"
sync_one "$SRC/rpc_endpoint.go" "$ROOT/services/control-api/internal/solana/rpc_endpoint.go"
sync_one "$SRC/blockchain_indexer.go" "$ROOT/services/control-api/internal/indexer/blockchain_indexer.go"
sudo sed -i 's/pollInterval := 400 \* time.Millisecond/pollInterval := 15 * time.Second/' "$ROOT/services/control-api/main.go" || true

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
echo MONEY_LOOP_API_OK
echo rollback_tag="$TAG"
