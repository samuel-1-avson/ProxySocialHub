#!/usr/bin/env bash
# Wallet production closure (Linux/macOS/CI). Schema checks + optional API + Go tests.
# Usage:
#   ./scripts/wallet-production-closure.sh
#   PGHOST=localhost PGUSER=proxyhubb PGDATABASE=proxyhubb PGPASSWORD=proxyhubb ./scripts/wallet-production-closure.sh
#   SKIP_TESTS=1 SKIP_API=1 ./scripts/wallet-production-closure.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-proxyhubb}"
PGDATABASE="${PGDATABASE:-proxyhubb}"
export PGPASSWORD="${PGPASSWORD:-proxyhubb}"

API_BASE="${API_BASE:-http://localhost:18080}"
TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/proxyhubb_test?sslmode=disable}"
SKIP_TESTS="${SKIP_TESTS:-0}"
SKIP_API="${SKIP_API:-0}"

PASS=0
FAIL=0

ok() { echo "[OK] $*"; PASS=$((PASS + 1)); }
bad() { echo "[FAIL] $*"; FAIL=$((FAIL + 1)); }

psql_q() {
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -t -A -c "$1"
}

echo ""
echo "=== Wallet production closure ==="
echo "Database: ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"
echo ""

if ! command -v psql >/dev/null 2>&1; then
  bad "psql not found"
else
  REQUIRED=(
    000080_withdrawal_security
    000081_user_flags
    000082_widen_explorer_numeric_columns
    000083_wallet_ledger_tx_hash
    000084_pending_tx_idempotency_fix
    000085_provider_registry_link
    000086_provider_nodes_base_price
    000087_listing_provider_node_link
    000088_remove_fiat_wallet_artifacts
  )
  HAS_SM="$(psql_q "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations');" 2>/dev/null || echo "f")"
  if echo "$HAS_SM" | grep -Fq "t"; then
    APPLIED="$(psql_q "SELECT version FROM schema_migrations WHERE version >= '000080' ORDER BY version;" 2>/dev/null || true)"
    for ver in "${REQUIRED[@]}"; do
      if echo "$APPLIED" | grep -Fq "$ver"; then
        ok "migration applied: $ver"
      else
        bad "migration missing: $ver"
      fi
    done
  else
    echo "[WARN] schema_migrations not populated (raw psql migrate?). Checking columns only."
  fi

  COLS="$(psql_q "SELECT column_name FROM information_schema.columns WHERE table_name = 'wallets' AND column_name IN ('withdrawal_whitelist','primary_withdrawal_address','withdrawal_address_changed_at','balance_usdt');")"
  for col in withdrawal_whitelist primary_withdrawal_address withdrawal_address_changed_at; do
    if echo "$COLS" | grep -Fq "$col"; then ok "wallets.$col present"; else bad "wallets.$col missing"; fi
  done
  if echo "$COLS" | grep -Fq balance_usdt; then bad "wallets.balance_usdt should be dropped"; else ok "wallets.balance_usdt removed"; fi

  if psql_q "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_flags');" | grep -Fq t; then
    ok "user_flags table exists"
  else
    bad "user_flags table missing"
  fi

  if psql_q "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallet_ledger_entries' AND column_name = 'tx_hash');" | grep -Fq t; then
    ok "wallet_ledger_entries.tx_hash present"
  else
    bad "wallet_ledger_entries.tx_hash missing"
  fi
fi

for f in docker-compose.dev.yml docker-compose.full.yml docker-compose.minimal.yml docker-compose.prod.yml; do
  if [[ -f "$f" ]] && grep -qiE 'paystack|PAYSTACK' "$f"; then
    bad "$f still references Paystack"
  elif [[ -f "$f" ]]; then
    ok "$f has no Paystack env"
  fi
done

if [[ "$SKIP_API" != "1" ]]; then
  if curl -sf "${API_BASE%/}/health" | grep -q '"status"'; then ok "GET /health"; else bad "GET /health"; fi
  if curl -sf "${API_BASE%/}/v1/treasury/public" | grep -q 'oracle_configured'; then ok "GET /v1/treasury/public"; else bad "GET /v1/treasury/public"; fi
  if curl -sf "${API_BASE%/}/v1/solana/health" | grep -q '"status"'; then ok "GET /v1/solana/health"; else bad "GET /v1/solana/health"; fi
fi

if [[ "$SKIP_TESTS" != "1" ]]; then
  echo ""
  echo "Running Go tests..."
  (
    cd services/control-api
    export TEST_DATABASE_URL EMERGENCY_SOL_PRICE_USD=200
    go test ./internal/billing/... -count=1
    go test ./internal/api/... -count=1 -run 'Wallet|Withdrawal|Whitelist|Cooldown|Crypto|GDPR|Treasury'
  ) && ok "go tests" || bad "go tests"
fi

echo ""
echo "=== Summary: ${PASS} passed, ${FAIL} failed ==="
if [[ "$FAIL" -gt 0 ]]; then
  echo "Manual steps: docs/WALLET_E2E_SMOKE.md"
  exit 1
fi
echo "Automated checks passed."
exit 0
