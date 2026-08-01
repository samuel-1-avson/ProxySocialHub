#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
TAR=/tmp/market-abc-web-20260801-171719.tar.gz
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extracting $TAR"
sudo tar -xzf "$TAR" -C /opt/proxyhubb
sudo find apps/web/src apps/web/next.config.ts -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -exec sed -i 's/\r$//' {} + 2>/dev/null || true
test -f apps/web/src/components/marketplace/MarketplaceDiscoverTabs.tsx
echo HAS_DISCOVER_TABS
sudo rm -rf apps/web/src/app/agents
COMPOSE=(sudo docker compose -f /opt/proxyhubb/docker-compose.yml -f /opt/proxyhubb/docker-compose.testnet.yml -f /opt/proxyhubb/docker-compose.gcp-testnet.yml)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building web"
"${COMPOSE[@]}" build web
"${COMPOSE[@]}" up -d --no-deps --force-recreate web
for i in $(seq 1 72); do
  st=$("${COMPOSE[@]}" ps web --format '{{.Status}}' 2>/dev/null || true)
  echo "try=$i $st"
  echo "$st" | grep -qi healthy && echo HEALTHY && break
  sleep 5
done
for path in / /marketplace /marketplace/map /marketplace/orders /dashboard/agents; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000$path" || echo fail)
  echo "local$path=$code"
done
agents_code=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000/agents" || echo fail)
agents_loc=$(curl -sS -o /dev/null -D - "http://127.0.0.1:3000/agents" 2>/dev/null | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r' | head -1)
echo "local/agents=$agents_code location=${agents_loc:-none}"
grep -qE '^MINT_BRONZE_PASS=.+' .env 2>/dev/null && echo MINT_BRONZE_PASS=SET || echo MINT_BRONZE_PASS=UNSET
grep -qE '^MINT_SILVER_PASS=.+' .env 2>/dev/null && echo MINT_SILVER_PASS=SET || echo MINT_SILVER_PASS=UNSET
grep -qE '^MINT_GOLD_PASS=.+' .env 2>/dev/null && echo MINT_GOLD_PASS=SET || echo MINT_GOLD_PASS=UNSET
echo DEPLOY_MARKET_ABC_DONE