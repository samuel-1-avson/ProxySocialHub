#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb

TAR="$(ls -1t /tmp/phase1-gateway-src-*.tar.gz | head -1)"
echo "Extracting ${TAR}"
sudo tar -xzf "${TAR}" -C /opt/proxyhubb
ls -la services/edge-gateway/src/registry/provider_selection.rs services/edge-gateway/src/state.rs services/edge-gateway/src/auth.rs

COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== build edge-gateway ==="
"${COMPOSE[@]}" build edge-gateway

echo "=== recreate control-api + edge-gateway ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api edge-gateway
sleep 25

echo "=== health ==="
curl -sS -o /dev/null -w "control-api_health=%{http_code}\n" http://127.0.0.1:18080/health || true
curl -sS http://127.0.0.1:18080/v1/network/status | head -c 300; echo

echo "=== indexes ==="
"${COMPOSE[@]}" exec -T postgres \
  psql -U proxyhubb -d proxyhubb -c \
  "SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_proxy_listings_active%' OR indexname LIKE 'idx_proxy_listings_status_country%' ORDER BY 1;"

echo "=== env ==="
grep -E "^(GATEWAY_USAGE_PUBLIC_KEY|SOLANA_PROGRAM_ID|PROVIDER_PRIVATE_KEY)=" .env \
  | sed -E "s/=(.{0,8}).*/=\1…/" || true

echo "=== ps ==="
"${COMPOSE[@]}" ps | head -30
echo DONE
