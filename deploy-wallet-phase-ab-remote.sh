#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb

TAR="$(ls -1t /tmp/wallet-phase-ab-deploy-*.tar.gz | head -1)"
echo "Extracting ${TAR}"
sudo tar -xzf "${TAR}" -C /opt/proxyhubb

sudo find services/control-api apps/web/src migrations -type f \( -name '*.go' -o -name '*.ts' -o -name '*.tsx' -o -name '*.sql' \) -exec sed -i 's/\r$//' {} + 2>/dev/null || true
sudo sed -i 's/\r$//' /tmp/deploy-wallet-phase-ab-remote.sh 2>/dev/null || true

COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== migrate (000114 linked_wallets backfill) ==="
"${COMPOSE[@]}" run --rm db-migrate

echo "=== build control-api + web ==="
"${COMPOSE[@]}" build control-api web

echo "=== recreate ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api web
sleep 25

echo "=== health ==="
curl -sS -o /dev/null -w "control-api_health=%{http_code}\n" http://127.0.0.1:18080/health || true
curl -sS -o /dev/null -w "web_root=%{http_code}\n" http://127.0.0.1:3000/ || true

echo "=== linked_wallets sample ==="
"${COMPOSE[@]}" exec -T postgres \
  psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -c \
  "SELECT COUNT(*) AS linked_solana_primary FROM linked_wallets WHERE chain='solana' AND is_primary=true;" \
  || true

echo "=== passes catalog still up ==="
curl -sS http://127.0.0.1:18080/v1/passes/catalog | head -c 200; echo

echo "=== ps ==="
"${COMPOSE[@]}" ps control-api web | head -20
echo DEPLOY_DONE
