#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb

TAR="$(ls -1t /tmp/access-passes-deploy-*.tar.gz | head -1)"
echo "Extracting ${TAR}"
sudo tar -xzf "${TAR}" -C /opt/proxyhubb

# Normalize CRLF if any Windows-packaged sources slipped through
sudo find services/control-api apps/web/src migrations -type f \( -name '*.go' -o -name '*.ts' -o -name '*.tsx' -o -name '*.sql' -o -name '*.yml' -o -name '*.yaml' \) -exec sed -i 's/\r$//' {} + 2>/dev/null || true
sudo sed -i 's/\r$//' /tmp/deploy-access-passes-remote.sh 2>/dev/null || true

COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== migrate (000113 access passes) ==="
"${COMPOSE[@]}" run --rm db-migrate

echo "=== build control-api + web ==="
"${COMPOSE[@]}" build control-api web

echo "=== recreate ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api web
sleep 25

echo "=== health ==="
curl -sS -o /dev/null -w "control-api_health=%{http_code}\n" http://127.0.0.1:18080/health || true
curl -sS -o /dev/null -w "web_root=%{http_code}\n" http://127.0.0.1:3000/ || true

echo "=== passes catalog ==="
curl -sS http://127.0.0.1:18080/v1/passes/catalog | head -c 500; echo

echo "=== migration tables ==="
"${COMPOSE[@]}" exec -T postgres \
  psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -c \
  "SELECT tablename FROM pg_tables WHERE tablename IN ('pass_purchases','pass_airdrop_claims') ORDER BY 1;" \
  || true

echo "=== mint env present? ==="
grep -E "^(MINT_BRONZE_PASS|MINT_SILVER_PASS|MINT_GOLD_PASS|PASS_.*PRICE)=" .env \
  | sed -E "s/=(.{0,12}).*/=\1…/" || echo "(mint/price env not set yet — Free tier still works)"

echo "=== ps ==="
"${COMPOSE[@]}" ps control-api web | head -20
echo DEPLOY_DONE
