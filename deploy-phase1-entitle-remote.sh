#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb

TAR="$(ls -1t /tmp/phase1-entitle-deploy-*.tar.gz | head -1)"
echo "Extracting ${TAR}"
sudo tar -xzf "${TAR}" -C /opt/proxyhubb

COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== migrate (includes 000110) ==="
"${COMPOSE[@]}" run --rm db-migrate

echo "=== build control-api edge-gateway ==="
"${COMPOSE[@]}" build control-api edge-gateway

echo "=== recreate ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api edge-gateway
sleep 20

echo "=== health ==="
curl -sS -o /dev/null -w "control-api_health=%{http_code}\n" http://127.0.0.1:18080/health || true
curl -sS http://127.0.0.1:18080/v1/network/status | head -c 300; echo

echo "=== migration 000110 verify ==="
"${COMPOSE[@]}" exec -T postgres \
  psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -c \
  "SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_proxy_listings_active%' OR indexname LIKE 'idx_proxy_listings_status_country%' ORDER BY 1;" \
  || true

echo "=== usage key env present? ==="
grep -E "^(GATEWAY_USAGE_PUBLIC_KEY|PROVIDER_PRIVATE_KEY|SOLANA_PROGRAM_ID)=" .env \
  | sed -E "s/=(.{0,8}).*/=\1…/" || true

echo "=== ps ==="
"${COMPOSE[@]}" ps | head -40
echo DONE
