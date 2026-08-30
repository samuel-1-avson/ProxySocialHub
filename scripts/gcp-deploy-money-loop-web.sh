#!/usr/bin/env bash
# Usage & billing history + analytics honesty for closed shop sessions.
# Never --remove-orphans. Never recreate edge-a or control-api.
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
WEB_CTR=proxyhubb-web-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-web:pre-money-loop-${STAMP}"
SRC="${MONEY_LOOP_WEB_SRC:-/tmp/money-loop-web}"
cd "$ROOT"
API_COMPOSE=(-f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
[[ -f docker-compose.w6-host-a-private.yml ]] && API_COMPOSE+=(-f docker-compose.w6-host-a-private.yml)
[[ -f docker-compose.w10-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-observe.yml)
[[ -f docker-compose.w10-listing-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-listing-observe.yml)
[[ -f docker-compose.w11-enforce.yml ]] && API_COMPOSE+=(-f docker-compose.w11-enforce.yml)

grep -q "getSessions('all')" "$SRC/usage-page.tsx"
grep -q "status === 'all'" "$SRC/sessions.ts"
grep -q 'total_requests' "$SRC/analytics-page.tsx"

EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
API_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
sudo docker tag proxyhubb-web "$TAG" || true
tr -d '\015' < "$SRC/usage-page.tsx" | sudo tee "$ROOT/apps/web/src/app/dashboard/usage/page.tsx" >/dev/null
tr -d '\015' < "$SRC/sessions.ts" | sudo tee "$ROOT/apps/web/src/lib/api/sessions.ts" >/dev/null
tr -d '\015' < "$SRC/analytics-page.tsx" | sudo tee "$ROOT/apps/web/src/app/dashboard/analytics/page.tsx" >/dev/null
sudo sed -i 's/\r$//' \
  "$ROOT/apps/web/src/app/dashboard/usage/page.tsx" \
  "$ROOT/apps/web/src/lib/api/sessions.ts" \
  "$ROOT/apps/web/src/app/dashboard/analytics/page.tsx"
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
echo MONEY_LOOP_WEB_OK
echo rollback_tag="$TAG"
