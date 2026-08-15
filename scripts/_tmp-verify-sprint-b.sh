#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

for i in $(seq 1 36); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' 2>/dev/null || true)
  echo "try=$i $st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done

echo "=== 000116 ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT version FROM schema_migrations WHERE version LIKE '%000116%';"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='wallets' AND column_name='balance_lamports';"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.wallet_ledger_entries'::regclass AND (tgname LIKE '%append%' OR tgname LIKE '%prevent%');"

echo "=== flags ==="
"${COMPOSE[@]}" exec -T control-api sh -c \
  'printf "ESCROW=%s SESSION=%s FINALIZED=%s LEGACY=%s VAULT_UI=%s\n" \
    "$PROXYHUB_REQUIRE_ESCROW_PDA" "$PROXYHUB_REQUIRE_SESSION_PDA" \
    "$PROXYHUB_DEPOSIT_REQUIRE_FINALIZED" "$PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT" \
    "$PROXYHUB_DEPOSIT_VAULT_UI"'

echo "=== archive dry-run ==="
DRY_RUN=1 bash scripts/wallet-ledger-archive.sh 2>&1 | tail -30 || true

echo "=== money-path smoke ==="
bash scripts/gcp-smoke-money-path.sh
