#!/usr/bin/env bash
# On-chain custody balances + pending + journal gap (uses .env RPC).
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
cd "$PROJECT_DIR"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

RPC="${RPC:-}"
if [[ -z "$RPC" ]]; then
  RPC=$(grep -E '^SOLANA_RPC_ENDPOINT=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
fi
if [[ -z "$RPC" ]]; then
  RPC=$(grep -E '^SOLANA_RPC_URL=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
fi
if [[ -z "$RPC" ]]; then
  # Prefer first of multi-endpoint list
  RAW=$(grep -E '^SOLANA_RPC_ENDPOINTS=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
  RPC=${RAW%%,*}
fi
if [[ -z "$RPC" ]]; then
  RPC="https://solana-devnet.api.onfinality.io/public"
fi
echo "rpc_host=$(python3 -c "from urllib.parse import urlparse; print(urlparse('$RPC').netloc)")"

VAULT=$(grep -E '^SOLANA_TREASURY_ADDRESS=' .env | cut -d= -f2- | tr -d '\r')
HOT=$(grep -E '^SOLANA_TREASURY_HOT_ADDRESS=' .env | cut -d= -f2- | tr -d '\r')
COLD=$(grep -E '^SOLANA_TREASURY_COLD_ADDRESS=' .env | cut -d= -f2- | tr -d '\r')

bal() {
  local a="$1"
  local i=0
  while [[ $i -lt 4 ]]; do
    if out=$(curl -sfS -m 25 "$RPC" -H 'Content-Type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$a\"]}" 2>/dev/null); then
      python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["result"]["value"])' "$out"
      return 0
    fi
    i=$((i+1))
    sleep $((2*i))
  done
  echo "FAILED"
  return 1
}

echo "=== ONCHAIN_BALANCES ==="
echo "vault=$VAULT"
VB=$(bal "$VAULT"); echo "vault_lamports=$VB"
echo "hot=$HOT"
HB=$(bal "$HOT"); echo "hot_lamports=$HB"
echo "cold=$COLD"
CB=$(bal "$COLD"); echo "cold_lamports=$CB"

if [[ "$VB" != FAILED && "$HB" != FAILED ]]; then
  COMBINED=$((VB+HB))
  LIAB=$("${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c \
    "SELECT COALESCE(SUM(balance_lamports),0) FROM wallets;" | tr -d '\r')
  python3 - <<PY
vb,hb,cb,liab = $VB,$HB,$CB,$LIAB
print(f"vault_sol={vb/1e9:.9f}")
print(f"hot_sol={hb/1e9:.9f}")
print(f"cold_sol={cb/1e9:.9f}")
print(f"combined_vault_hot_sol={(vb+hb)/1e9:.9f}")
print(f"liabilities_sol={liab/1e9:.9f}")
print(f"deficit_sol={(liab-(vb+hb))/1e9:.9f}")
print(f"with_cold_surplus_sol={(vb+hb+cb-liab)/1e9:.9f}")
PY
fi

echo "=== PENDING ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT status::text, COUNT(*), COALESCE(SUM(amount_lamports),0) FROM pending_transactions GROUP BY 1 ORDER BY 1;" \
  2>/dev/null || echo "(pending_transactions query failed)"

echo "=== JOURNAL GAP ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "
SELECT
  (SELECT COALESCE(SUM(amount_lamports),0) FROM wallet_ledger_entries WHERE wallet_id='fe793802-7249-423c-a502-780b6a5d48f8') AS ledger_sum,
  (SELECT COALESCE(SUM(amount_lamports),0) FROM ledger_journal_lines WHERE account_code='2100' AND wallet_id='fe793802-7249-423c-a502-780b6a5d48f8') AS journal_2100,
  (SELECT balance_lamports FROM wallets WHERE id='fe793802-7249-423c-a502-780b6a5d48f8') AS wallet_bal,
  (SELECT balance_lamports FROM wallets WHERE id='fe793802-7249-423c-a502-780b6a5d48f8')
    + (SELECT COALESCE(SUM(amount_lamports),0) FROM ledger_journal_lines WHERE account_code='2100' AND wallet_id='fe793802-7249-423c-a502-780b6a5d48f8') AS journal_drift;
"

echo "=== RECON TABLE ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%reconcil%';" \
  || true

echo ONCHAIN_TRIAGE_DONE
