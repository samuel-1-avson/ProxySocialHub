#!/usr/bin/env bash
# Hotfix: streaming session card uses gateway bytes + SOL/GB, not fake hourly vest.
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
WEB_CTR=proxyhubb-web-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-web:pre-stream-fix-${STAMP}"
SRC="${STREAM_FIX_SRC:-/tmp/stream-fix}"

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

grep -q 'Metered amount' "$SRC/StreamingSessionCard.tsx"
grep -q 'bandwidth_used' "$SRC/sessions.ts"

EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
API_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
sudo docker tag proxyhubb-web "$TAG" || true

tr -d '\015' < "$SRC/StreamingSessionCard.tsx" | sudo tee "$ROOT/apps/web/src/components/StreamingSessionCard.tsx" >/dev/null
tr -d '\015' < "$SRC/sessions.ts" | sudo tee "$ROOT/apps/web/src/lib/api/sessions.ts" >/dev/null
sudo sed -i 's/\r$//' "$ROOT/apps/web/src/components/StreamingSessionCard.tsx" "$ROOT/apps/web/src/lib/api/sessions.ts"

sudo docker compose "${API_COMPOSE[@]}" build web
sudo docker compose "${API_COMPOSE[@]}" up -d --no-deps --force-recreate web

ok=0
for i in $(seq 1 60); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$WEB_CTR" 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  if [[ "$st" == "healthy" ]]; then ok=1; break; fi
  sleep 3
done
[[ "$ok" == "1" ]] || { echo "FAIL: web not healthy"; sudo docker logs --tail 40 "$WEB_CTR"; exit 2; }
EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }
API_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
[[ "$API_STARTED_BEFORE" == "$API_STARTED_AFTER" ]] || { echo "FAIL: control-api was recreated"; exit 2; }

if sudo docker exec "$WEB_CTR" sh -c "grep -rqs 'Metered amount' /app/app/.next || grep -rqs 'gateway bytes' /app/app/.next"; then
  echo "bundle: metered copy present"
else
  echo "FAIL: metered copy not in bundle"
  exit 2
fi

echo STREAM_FIX_OK
echo rollback_tag="$TAG"
