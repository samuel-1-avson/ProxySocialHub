#!/usr/bin/env bash
# Dashboard honesty: provider nodes by user_id, no wallet-as-earnings, session bytes.
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
CTR=proxyhubb-control-api-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-control-api:pre-dash-fix-${STAMP}"
SRC="${DASH_FIX_SRC:-/tmp/dash-fix}"
cd "$ROOT"
API_COMPOSE=(-f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
[[ -f docker-compose.w6-host-a-private.yml ]] && API_COMPOSE+=(-f docker-compose.w6-host-a-private.yml)
[[ -f docker-compose.w10-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-observe.yml)
[[ -f docker-compose.w10-listing-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-listing-observe.yml)
[[ -f docker-compose.w11-enforce.yml ]] && API_COMPOSE+=(-f docker-compose.w11-enforce.yml)
grep -q 'OnlineNodes' "$SRC/analytics.go"
grep -q 'user_id = ? AND status' "$SRC/analytics.go"
EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
sudo docker tag proxyhubb-control-api "$TAG" || true
tr -d '\015' < "$SRC/analytics.go" | sudo tee "$ROOT/services/control-api/internal/api/analytics.go" >/dev/null
sudo sed -i 's/\r$//' "$ROOT/services/control-api/internal/api/analytics.go"
sudo docker compose "${API_COMPOSE[@]}" build control-api
sudo docker compose "${API_COMPOSE[@]}" up -d --no-deps --force-recreate control-api
ok=0
for i in $(seq 1 40); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CTR" 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  if [[ "$st" == "healthy" ]]; then ok=1; break; fi
  sleep 3
done
[[ "$ok" == "1" ]] || { echo "FAIL: control-api not healthy"; exit 2; }
EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }
echo DASH_API_OK
echo rollback_tag="$TAG"
