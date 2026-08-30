#!/usr/bin/env bash
# Dashboard + sessions honesty UI.
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
WEB_CTR=proxyhubb-web-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-web:pre-dash-fix-${STAMP}"
SRC="${DASH_WEB_SRC:-/tmp/dash-web}"
cd "$ROOT"
API_COMPOSE=(-f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
[[ -f docker-compose.w6-host-a-private.yml ]] && API_COMPOSE+=(-f docker-compose.w6-host-a-private.yml)
[[ -f docker-compose.w10-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-observe.yml)
[[ -f docker-compose.w10-listing-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-listing-observe.yml)
[[ -f docker-compose.w11-enforce.yml ]] && API_COMPOSE+=(-f docker-compose.w11-enforce.yml)
grep -q 'online_nodes' "$SRC/analytics.ts"
grep -q 'Marketplace purchases' "$SRC/sessions-page.tsx"
EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
API_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
sudo docker tag proxyhubb-web "$TAG" || true
tr -d '\015' < "$SRC/analytics.ts" | sudo tee "$ROOT/apps/web/src/lib/api/analytics.ts" >/dev/null
tr -d '\015' < "$SRC/dashboard-page.tsx" | sudo tee "$ROOT/apps/web/src/app/dashboard/page.tsx" >/dev/null
tr -d '\015' < "$SRC/sessions-page.tsx" | sudo tee "$ROOT/apps/web/src/app/dashboard/sessions/page.tsx" >/dev/null
tr -d '\015' < "$SRC/trustless-page.tsx" | sudo tee "$ROOT/apps/web/src/app/dashboard/trustless/page.tsx" >/dev/null
sudo sed -i 's/\r$//' \
  "$ROOT/apps/web/src/lib/api/analytics.ts" \
  "$ROOT/apps/web/src/app/dashboard/page.tsx" \
  "$ROOT/apps/web/src/app/dashboard/sessions/page.tsx" \
  "$ROOT/apps/web/src/app/dashboard/trustless/page.tsx"
sudo docker compose "${API_COMPOSE[@]}" build web
sudo docker compose "${API_COMPOSE[@]}" up -d --no-deps --force-recreate web
ok=0
for i in $(seq 1 60); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$WEB_CTR" 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  if [[ "$st" == "healthy" ]]; then ok=1; break; fi
  sleep 3
done
[[ "$ok" == "1" ]] || { echo "FAIL: web not healthy"; exit 2; }
EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }
API_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
[[ "$API_STARTED_BEFORE" == "$API_STARTED_AFTER" ]] || { echo "FAIL: control-api was recreated"; exit 2; }
echo DASH_WEB_OK
echo rollback_tag="$TAG"
