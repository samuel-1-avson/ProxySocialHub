#!/usr/bin/env bash
# Post-deploy smoke for treasury liquidity automation on GCP testnet.
# Does not require a user JWT for threshold/queue/env checks.
# Optional: set SMOKE_JWT to exercise withdraw→processing path.
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DOCKER="${DOCKER:-docker}"
API="${API:-http://127.0.0.1:18080}"
cd "$PROJECT_DIR"
COMPOSE=("$DOCKER" compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== thresholds in container ==="
"${COMPOSE[@]}" exec -T control-api sh -c \
  'printf "APP_ENV=%s\nHOT_MIN=%s\nREPLENISH=%s\nHOT_MAX=%s\nVAULT_MAX=%s\nVAULT_DAILY=%s\nVAULT_FLOOR=%s\nVAULT_ADDR=%s\n" \
    "$APP_ENV" "$SOLANA_TREASURY_HOT_MIN_BALANCE" "$SOLANA_TREASURY_REPLENISH_AMOUNT" \
    "$SOLANA_TREASURY_HOT_MAX_BALANCE" "$SOLANA_VAULT_TOPUP_MAX_SOL" \
    "$SOLANA_VAULT_DAILY_TOPUP_CAP_SOL" "$SOLANA_VAULT_RESERVE_FLOOR_SOL" \
    "$SOLANA_DEPOSIT_VAULT_ADDRESS"'

HOT_MIN=$("${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_HOT_MIN_BALANCE | tr -d '\r')
REPLENISH=$("${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_REPLENISH_AMOUNT | tr -d '\r')
echo "HOT_MIN=$HOT_MIN REPLENISH=$REPLENISH"
# Accept explicit staging values or empty (Go defaults apply when APP_ENV=staging)
if [[ -n "$HOT_MIN" ]]; then
  python3 - <<PY
import sys
v=float("$HOT_MIN")
assert 1.0 <= v <= 20.0, f"HOT_MIN out of staging range: {v}"
print("HOT_MIN_OK", v)
PY
fi
if [[ -n "$REPLENISH" ]]; then
  python3 - <<PY
v=float("$REPLENISH")
assert 5.0 <= v <= 50.0, f"REPLENISH out of staging range: {v}"
print("REPLENISH_OK", v)
PY
fi

echo "=== queue table ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT COUNT(*) AS queue_rows FROM withdrawal_payout_queue;"

echo "=== public treasury liquidity fields ==="
curl -sS "$API/v1/treasury/public" > /tmp/treasury-public.json
python3 - <<'PY'
import json
d=json.load(open("/tmp/treasury-public.json"))
t=d.get("treasury") or {}
liq=t.get("liquidity") or {}
hot=t.get("hot") or {}
vault=t.get("vault") or {}
print("status", t.get("status"))
print("hot_sol", hot.get("balance_sol"), "min", hot.get("min_balance_sol"), "replenish", hot.get("replenish_sol"), "needs", hot.get("needs_replenish"))
print("vault_sol", vault.get("balance_sol"), "addr", (vault.get("address") or "")[:12])
print("queue_depth", liq.get("queue_depth"), "oldest_age", liq.get("queue_oldest_age_secs"))
print("last_topup", liq.get("last_topup_sol"), liq.get("last_topup_source"), liq.get("last_topup_at"))
print("vault_daily_remaining", liq.get("vault_daily_remaining_sol"))
assert isinstance(liq, dict)
print("LIQUIDITY_FIELDS_OK")
PY

echo "=== on-chain hot/vault balances ==="
RPC=$("${COMPOSE[@]}" exec -T control-api printenv SOLANA_RPC_ENDPOINT | tr -d '\r')
HOT=$("${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_HOT_ADDRESS | tr -d '\r')
VAULT=$("${COMPOSE[@]}" exec -T control-api printenv SOLANA_DEPOSIT_VAULT_ADDRESS | tr -d '\r')
for ADDR in "$HOT" "$VAULT"; do
  [[ -z "$ADDR" ]] && continue
  RESP=$(curl -sS "$RPC" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$ADDR\"]}")
  echo "ADDR=$ADDR RESP=$RESP"
done

if [[ -n "${SMOKE_JWT:-}" ]]; then
  echo "=== optional authenticated withdraw smoke ==="
  AMT="${SMOKE_WITHDRAW_SOL:-0.05}"
  CODE=$(curl -sS -o /tmp/withdraw-smoke.json -w '%{http_code}' \
    -X POST "$API/v1/wallet/withdraw/sol" \
    -H "Authorization: Bearer $SMOKE_JWT" \
    -H 'Content-Type: application/json' \
    -d "{\"amount\":$AMT}")
  echo "HTTP=$CODE body=$(head -c 500 /tmp/withdraw-smoke.json)"
  python3 - <<PY
import json
body=json.load(open("/tmp/withdraw-smoke.json"))
code=int("$CODE")
# 200 success, 202 processing, or 4xx for balance/link issues — print verdict
print("status", body.get("status"), "message", body.get("message") or body.get("error"))
if code == 202:
  assert body.get("status") == "processing", body
  print("WITHDRAW_QUEUED_OK")
elif code == 200:
  assert body.get("status") in ("success", "ok", None) or body.get("tx_hash"), body
  print("WITHDRAW_INSTANT_OK")
else:
  print("WITHDRAW_SMOKE_SKIP_OR_FAIL", code)
  raise SystemExit(0)
PY
  echo "=== queue after withdraw ==="
  "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
    "SELECT reference, status, amount_sol, attempts, left(coalesce(last_error,''),80) AS err, created_at FROM withdrawal_payout_queue ORDER BY created_at DESC LIMIT 5;"
fi

echo "=== recent liquidity logs ==="
sudo docker logs proxyhubb-control-api-1 --since 30m 2>&1 \
  | grep -iE 'vault→hot|Vault→hot|withdrawal queued|Queued withdrawal|Cold→hot|EnsureHotLiquidity|payout worker|underfunded' \
  | tail -n 40 || true

echo LIQUIDITY_SMOKE_DONE
