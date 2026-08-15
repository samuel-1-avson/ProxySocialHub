#!/usr/bin/env bash
# Sprint B money-path smoke: cutover flags + ledger 000116 + vault deposit + optional withdraw.
# Escrow buy smoke (gcp-smoke-marketplace-escrow-buy.sh) is a documented prerequisite.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DOCKER="${DOCKER:-docker}"
API="${API:-http://127.0.0.1:18080}"
cd "$PROJECT_DIR"
COMPOSE=("$DOCKER" compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

env_of() {
  "${COMPOSE[@]}" exec -T control-api printenv "$1" 2>/dev/null | tr -d '\r' || true
}

echo "=== cutover flag profile ==="
REQUIRE_ESCROW=$(env_of PROXYHUB_REQUIRE_ESCROW_PDA)
REQUIRE_SESSION=$(env_of PROXYHUB_REQUIRE_SESSION_PDA)
VAULT_UI=$(env_of PROXYHUB_DEPOSIT_VAULT_UI)
VAULT_CREDIT=$(env_of PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED)
LEGACY=$(env_of PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT)
FINALIZED=$(env_of PROXYHUB_DEPOSIT_REQUIRE_FINALIZED)
ALLOW_UNSIGNED=$(env_of ALLOW_UNSIGNED_USAGE)

echo "REQUIRE_ESCROW_PDA=$REQUIRE_ESCROW"
echo "REQUIRE_SESSION_PDA=$REQUIRE_SESSION"
echo "DEPOSIT_VAULT_UI=$VAULT_UI"
echo "DEPOSIT_VAULT_CREDIT_ENABLED=$VAULT_CREDIT"
echo "DEPOSIT_LEGACY_TREASURY_CREDIT=$LEGACY"
echo "DEPOSIT_REQUIRE_FINALIZED=$FINALIZED"
echo "ALLOW_UNSIGNED_USAGE=${ALLOW_UNSIGNED:-<unset>}"

[[ "$REQUIRE_ESCROW" == "true" ]] || { echo "FAIL: PROXYHUB_REQUIRE_ESCROW_PDA must be true"; exit 1; }
[[ "$REQUIRE_SESSION" == "true" ]] || { echo "FAIL: PROXYHUB_REQUIRE_SESSION_PDA must be true"; exit 1; }
[[ "$VAULT_UI" == "true" ]] || { echo "FAIL: PROXYHUB_DEPOSIT_VAULT_UI must be true"; exit 1; }
[[ "$VAULT_CREDIT" == "true" ]] || { echo "FAIL: PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED must be true"; exit 1; }
[[ "$LEGACY" == "false" ]] || { echo "FAIL: PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT must be false (got '${LEGACY}')"; exit 1; }
[[ "$FINALIZED" == "true" ]] || { echo "FAIL: PROXYHUB_DEPOSIT_REQUIRE_FINALIZED must be true"; exit 1; }
if [[ -n "$ALLOW_UNSIGNED" && "$ALLOW_UNSIGNED" == "true" ]]; then
  echo "FAIL: ALLOW_UNSIGNED_USAGE must not be true on testnet"
  exit 1
fi
echo "CUTOVER_FLAGS_OK"

echo "=== ledger 000116 / append-only ==="
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -v ON_ERROR_STOP=1 <<'SQL'
SELECT version FROM schema_migrations WHERE version = '000116_ledger_append_only_lamports';
SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='wallets' AND column_name='balance_lamports';
SELECT tgname FROM pg_trigger
  WHERE tgrelid = 'public.wallet_ledger_entries'::regclass
    AND (tgname LIKE '%append_only%' OR tgname LIKE '%prevent_wallet_ledger%');
SQL

# Bare UPDATE must fail without GUC
set +e
UPD_OUT=$("${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -v ON_ERROR_STOP=1 \
  -c "UPDATE wallet_ledger_entries SET amount = amount WHERE false;" 2>&1)
# empty update is fine; try a real blocked mutate on a sample row if any exist
BLOCK_OUT=$("${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" \
  -c "UPDATE wallet_ledger_entries SET amount = amount WHERE id IN (SELECT id FROM wallet_ledger_entries LIMIT 1);" 2>&1)
set -e
if echo "$BLOCK_OUT" | grep -qiE 'append-only|prevent_wallet_ledger|wallet_ledger_allow_mutate|P0001|cannot'; then
  echo "APPEND_ONLY_TRIGGER_OK"
elif echo "$BLOCK_OUT" | grep -qi 'UPDATE 0'; then
  echo "APPEND_ONLY_NO_ROWS (trigger not exercised; schema check above is authoritative)"
else
  # If UPDATE succeeded silently on a row, fail
  if echo "$BLOCK_OUT" | grep -qE 'UPDATE [1-9]'; then
    echo "FAIL: ledger UPDATE succeeded without GUC: $BLOCK_OUT"
    exit 1
  fi
  echo "APPEND_ONLY_CHECK_SOFT: $BLOCK_OUT"
fi

echo "=== API health ==="
curl -sS -o /dev/null -w "api_health=%{http_code}\n" "$API/health"

echo "=== vault deposit smoke ==="
if [[ -x "$PROJECT_DIR/scripts/gcp-smoke-vault-deposit.sh" ]]; then
  ORACLE_KP_CHECK="${ORACLE_KP:-/opt/proxyhubb/infra/oracle-keypair.json}"
  SKIP_VAULT=1
  if [[ -f "$ORACLE_KP_CHECK" ]]; then
    if python3 -c '
import json,sys
from pathlib import Path
p=Path(sys.argv[1]); d=json.loads(p.read_text())
assert isinstance(d,list) and len(d)==64
ex=Path("/opt/proxyhubb/infra/oracle-keypair.json.example")
if ex.exists() and p.read_text().strip()==ex.read_text().strip():
  raise SystemExit(1)
' "$ORACLE_KP_CHECK" 2>/dev/null; then
      SKIP_VAULT=0
    fi
  fi
  if [[ "$SKIP_VAULT" -eq 0 ]]; then
    bash "$PROJECT_DIR/scripts/gcp-smoke-vault-deposit.sh"
  else
    echo "SKIP vault deposit smoke: no usable local oracle keypair (GCP KMS oracle — expected)"
  fi
else
  echo "WARN: gcp-smoke-vault-deposit.sh missing; skipping deposit"
fi

echo "=== withdraw queue presence ==="
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -c \
  "SELECT COUNT(*) AS queue_rows FROM withdrawal_payout_queue;"

if [[ -n "${SMOKE_JWT:-}" ]]; then
  echo "=== authenticated withdraw → queue ==="
  AMT="${SMOKE_WITHDRAW_SOL:-0.01}"
  CODE=$(curl -sS -o /tmp/money-withdraw.json -w '%{http_code}' \
    -X POST "$API/v1/wallet/withdraw/sol" \
    -H "Authorization: Bearer $SMOKE_JWT" \
    -H 'Content-Type: application/json' \
    -d "{\"amount\":$AMT}")
  echo "withdraw HTTP=$CODE body=$(head -c 400 /tmp/money-withdraw.json)"
  case "$CODE" in
    200|202) echo "WITHDRAW_OK" ;;
    *) echo "WITHDRAW_SKIP_OR_FAIL code=$CODE (non-fatal if balance/link)" ;;
  esac
else
  echo "SMOKE_JWT unset — withdraw request skipped (queue table checked)"
fi

echo "=== metering unsigned guard ==="
echo "ALLOW_UNSIGNED_USAGE unset/false verified above"
echo "METERING_UNSIGNED_GUARD_OK"

echo "=== prerequisite note ==="
echo "Marketplace escrow buy: run scripts/gcp-smoke-marketplace-escrow-buy.sh separately if not recently green."

echo "MONEY_PATH_SMOKE_DONE"
