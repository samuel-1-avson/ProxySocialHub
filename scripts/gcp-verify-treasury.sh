#!/bin/bash
cd /opt/proxyhubb
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
echo "=== env file ==="
grep SOLANA_TREASURY .env
echo "=== container ==="
"${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_ADDRESS || true
"${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_HOT_ADDRESS || echo "(HOT not in container env)"
echo "=== db ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "SELECT key, value FROM system_configurations WHERE key='treasury_wallet_solana';"
echo "=== public api ==="
curl -sS http://127.0.0.1:18080/v1/system/config/public; echo
