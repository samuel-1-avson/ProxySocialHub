#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
echo "=== liabilities ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT COUNT(*) AS wallets, COALESCE(SUM(balance_lamports),0) AS sum_lamports, ROUND(COALESCE(SUM(balance_lamports),0)/1000000000.0,9) AS sum_sol FROM wallets;"
echo "=== recent deposit-ish ledger (top 10) ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT created_at, amount_lamports, ROUND(amount_lamports/1000000000.0,6) AS sol, COALESCE(reference,'') AS reference FROM wallet_ledger_entries WHERE amount_lamports > 0 ORDER BY created_at DESC LIMIT 10;" 2>/dev/null || true
echo "=== control-api deficit/surplus last 30m ==="
"${COMPOSE[@]}" logs --since=30m control-api 2>/dev/null | grep -Ei 'treasury deficit|Treasury surplus|Reconciliation:|Balances matched|ops_alerts' | tail -20 || true
echo TOPUP_CHECK_DONE
