#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
echo "=== addresses ==="
grep -E '^(SOLANA_TREASURY_ADDRESS|SOLANA_TREASURY_HOT_ADDRESS|SOLANA_DEPOSIT_VAULT)=' .env | tr -d '\r' || true
echo "=== grants ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'proxyhubb' AND table_name LIKE '%ledger%' ORDER BY 1,2;"
T=$(grep -E '^SOLANA_TREASURY_ADDRESS=' .env | cut -d= -f2 | tr -d '\r')
H=$(grep -E '^SOLANA_TREASURY_HOT_ADDRESS=' .env | cut -d= -f2 | tr -d '\r')
echo "treasury=$T"
echo "hot=$H"
[[ "$T" == "$H" ]] && echo SKIP_SWEEP_treasury_eq_hot || echo SWEEP_CANDIDATE
echo DONE
