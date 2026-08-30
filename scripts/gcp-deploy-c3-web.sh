#!/usr/bin/env bash
# C.3 — deploy web (cluster checks + extension unpacked-ID UI) to Host-A.
# Safety: backup source tree, tag previous image, no --remove-orphans, never recreate edges.
#
# Upload web-deploy.tar.gz + this script to /tmp/web-deploy/ then:
#   CONFIRM_WEB_DEPLOY=1 bash /tmp/web-deploy/run.sh
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
WEB_CTR=proxyhubb-web-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-web:pre-c3-web-${STAMP}"
SRC="${WEB_SRC:-/tmp/web-deploy}"
TARBALL="$SRC/web-deploy.tar.gz"

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

echo "=== C.3 web deploy ==="
echo "root=$ROOT stamp=$STAMP confirm=${CONFIRM_WEB_DEPLOY:-}"

[[ -f "$TARBALL" ]] || { echo "FAIL: missing $TARBALL"; exit 2; }
for f in docker-compose.yml docker-compose.testnet.yml docker-compose.gcp-testnet.yml; do
  [[ -f "$f" ]] || { echo "FAIL: missing overlay $f"; exit 2; }
done

echo "--- tarball sanity ---"
MANIFEST=/tmp/web-deploy/manifest.txt
tar -tzf "$TARBALL" > "$MANIFEST"
grep -E '^\./src/lib/solana\.ts$|^\./src/components/BuyListingModal\.tsx$|^\./src/components/marketplace/ExtensionConnectCard\.tsx$|^\./src/lib/extension\.ts$|^\./package\.json$|^\./next\.config\.ts$' "$MANIFEST" | sort
for want in ./src/lib/solana.ts ./src/components/BuyListingModal.tsx ./src/components/marketplace/ExtensionConnectCard.tsx ./src/lib/extension.ts ./package.json ./next.config.ts; do
  grep -qxF "$want" "$MANIFEST" || { echo "FAIL: tarball missing $want"; exit 2; }
done

echo "--- current image ---"
sudo docker inspect -f 'id={{.Image}} created={{.Created}} started={{.State.StartedAt}}' "$WEB_CTR"
EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
API_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
echo "edge-a started=$EDGE_A_STARTED_BEFORE"
echo "control-api started=$API_STARTED_BEFORE"

if [[ "${CONFIRM_WEB_DEPLOY:-}" != "1" ]]; then
  echo "INSPECT ONLY: set CONFIRM_WEB_DEPLOY=1 to sync, build, and swap"
  exit 0
fi

echo "--- backup current web source ---"
sudo cp -a "$ROOT/apps/web" "$ROOT/apps/web.bak-c3-${STAMP}"
echo "backup=$ROOT/apps/web.bak-c3-${STAMP}"

echo "--- extract tarball over apps/web ---"
sudo tar -xzf "$TARBALL" -C "$ROOT/apps/web"
grep -q 'shopSolanaClusterLabel' "$ROOT/apps/web/src/lib/solana.ts" || { echo "FAIL: new solana.ts not in place"; exit 2; }
grep -q 'setStoredUnpackedExtensionId' "$ROOT/apps/web/src/lib/extension.ts" || { echo "FAIL: new extension.ts not in place"; exit 2; }
echo "source synced"

echo "--- tag previous image ---"
sudo docker tag proxyhubb-web "$TAG" || true
echo "rollback_tag=$TAG"

echo "--- build web ---"
sudo docker compose "${API_COMPOSE[@]}" build web

echo "--- swap web only (no --remove-orphans, no edges) ---"
sudo docker compose "${API_COMPOSE[@]}" up -d --no-deps --force-recreate web

echo "--- wait healthy ---"
ok=0
for i in $(seq 1 60); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$WEB_CTR" 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  if [[ "$st" == "healthy" ]]; then
    ok=1
    break
  fi
  sleep 3
done
[[ "$ok" == "1" ]] || { echo "FAIL: web not healthy"; sudo docker logs --tail 60 "$WEB_CTR" || true; exit 2; }

echo "--- verify ---"
EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }
API_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
[[ "$API_STARTED_BEFORE" == "$API_STARTED_AFTER" ]] || { echo "FAIL: control-api was recreated"; exit 2; }

# Standalone layout: server at /app/app/server.js, bundles under /app/app/.next
if sudo docker exec "$WEB_CTR" sh -c "grep -rqs 'set Phantom to that cluster' /app/app/.next"; then
  echo "bundle: cluster hint present"
else
  echo "FAIL: cluster hint not in built bundle"
  exit 2
fi

site=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 https://proxyhubb.com/ || echo fail)
echo "site_https=$site"
[[ "$site" == "200" ]] || { echo "FAIL: site $site"; exit 2; }
mk=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 https://proxyhubb.com/marketplace || echo fail)
echo "marketplace_https=$mk"
[[ "$mk" == "200" ]] || { echo "FAIL: marketplace $mk"; exit 2; }
wh=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 https://proxyhubb.com/api/health || echo fail)
echo "web_api_health=$wh"

echo WEB_DEPLOY_OK
echo rollback_tag="$TAG"
