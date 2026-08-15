#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
echo "=== wallets ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT id::text, user_id::text, balance_lamports, ROUND(balance_lamports/1000000000.0,9) AS sol FROM wallets ORDER BY balance_lamports DESC;"
echo "=== large credits last 2h ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT created_at, wallet_id::text, amount_lamports, ROUND(amount_lamports/1000000000.0,6) AS sol, COALESCE(entry_type::text,'') AS entry_type, COALESCE(reference,'') AS reference, COALESCE(notes,'') AS notes FROM wallet_ledger_entries WHERE amount_lamports >= 1000000000 ORDER BY created_at DESC LIMIT 15;" 2>/dev/null \
  || "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT created_at, wallet_id::text, amount_lamports, ROUND(amount_lamports/1000000000.0,6) AS sol, COALESCE(reference,'') AS reference FROM wallet_ledger_entries WHERE amount_lamports >= 1000000000 ORDER BY created_at DESC LIMIT 15;"
echo "=== linked wallets for big holders ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT w.id::text AS wallet_id, ROUND(w.balance_lamports/1000000000.0,3) AS sol, lw.address FROM wallets w LEFT JOIN linked_wallets lw ON lw.user_id=w.user_id AND lw.chain='solana' ORDER BY w.balance_lamports DESC;"
echo TOPUP_TRACE_DONE
