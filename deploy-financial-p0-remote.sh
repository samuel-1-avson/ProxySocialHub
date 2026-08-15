#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb

TAR="$(ls -1t /tmp/financial-p0-deploy-*.tar.gz | head -1)"
echo "Extracting ${TAR}"
sudo tar -xzf "${TAR}" -C /opt/proxyhubb

COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== migrate ==="
"${COMPOSE[@]}" run --rm db-migrate

echo "=== build control-api edge-gateway ==="
"${COMPOSE[@]}" build control-api edge-gateway

echo "=== recreate ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api edge-gateway
sleep 15

echo "=== health ==="
curl -sS -o /dev/null -w 'control-api_health=%{http_code}\n' http://127.0.0.1:18080/health || true
curl -sS -o /dev/null -w 'gateway_usage_noauth=%{http_code}\n' \
  -X POST http://127.0.0.1:18080/v1/gateway/usage/report \
  -H 'Content-Type: application/json' \
  -d '{"reports":[]}' || true

echo "=== migration 000109 ==="
"${COMPOSE[@]}" exec -T postgres \
  psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -c \
  "SELECT indexname FROM pg_indexes WHERE indexname='idx_wallet_ledger_wallet_type_ref'; SELECT to_regclass('public.wallet_ledger_entries_archive') AS archive_table;" \
  || "${COMPOSE[@]}" exec -T postgres \
  psql -U postgres -d proxyhubb -c \
  "SELECT indexname FROM pg_indexes WHERE indexname='idx_wallet_ledger_wallet_type_ref'; SELECT to_regclass('public.wallet_ledger_entries_archive') AS archive_table;"

echo "=== ps ==="
"${COMPOSE[@]}" ps | head -40
echo DONE
