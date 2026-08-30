#!/usr/bin/env bash
# Let Stop Stream / Terminate close marketplace-linked sessions and complete
# the shop order. Never --remove-orphans. Never recreate edge-a.
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
CTR=proxyhubb-control-api-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-control-api:pre-session-settle-${STAMP}"
SRC="${SESSION_SETTLE_API_SRC:-/tmp/session-settle-api}"
cd "$ROOT"
API_COMPOSE=(-f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
[[ -f docker-compose.w6-host-a-private.yml ]] && API_COMPOSE+=(-f docker-compose.w6-host-a-private.yml)
[[ -f docker-compose.w10-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-observe.yml)
[[ -f docker-compose.w10-listing-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-listing-observe.yml)
[[ -f docker-compose.w11-enforce.yml ]] && API_COMPOSE+=(-f docker-compose.w11-enforce.yml)

grep -q 'completeOpenMarketplaceOrderForSession' "$SRC/session.go"
grep -q 'syncSessionUsageFromRedis' "$SRC/session.go"
! grep -q 'Cancel or settle the order instead of terminating' "$SRC/session.go"
grep -q 'redisUsage > totalBytes' "$SRC/usage.go"

EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
sudo docker tag proxyhubb-control-api "$TAG" || true
tr -d '\015' < "$SRC/session.go" | sudo tee "$ROOT/services/control-api/internal/api/session.go" >/dev/null
tr -d '\015' < "$SRC/usage.go" | sudo tee "$ROOT/services/control-api/internal/api/usage.go" >/dev/null
sudo sed -i 's/\r$//' \
  "$ROOT/services/control-api/internal/api/session.go" \
  "$ROOT/services/control-api/internal/api/usage.go"
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
echo SESSION_SETTLE_API_OK
echo rollback_tag="$TAG"
