#!/usr/bin/env bash
# Deploy deposit caps + recredit stuck deposits + optionally airdrop hot wallet.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?Set DEPLOY_TAR}"
DOCKER="${DOCKER:-docker}"
RECREDIT_SPECS="${RECREDIT_SPECS:-}"
AIRDROP_HOT_SOL="${AIRDROP_HOT_SOL:-0}"

cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extracting $DEPLOY_TAR"
tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"
if [[ -d "$tmpdir/control-api" ]]; then
  mkdir -p "$PROJECT_DIR/services/control-api"
  cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
fi
if [[ -d "$tmpdir/scripts" ]]; then
  mkdir -p "$PROJECT_DIR/scripts"
  cp -a "$tmpdir/scripts/." "$PROJECT_DIR/scripts/"
fi
rm -rf "$tmpdir"

find "$PROJECT_DIR/services/control-api" "$PROJECT_DIR/scripts" \
  -type f \( -name '*.go' -o -name '*.sh' \) -exec sed -i 's/\r$//' {} + 2>/dev/null || true
chmod +x "$PROJECT_DIR/scripts/"*.sh 2>/dev/null || true

grep -q 'SumDepositsSince' "$PROJECT_DIR/services/control-api/internal/models/deposit_limits.go"
grep -q 'RecreditDeposits' "$PROJECT_DIR/services/control-api/internal/ops/recredit_deposits.go"
grep -q 'RECREDIT_DEPOSITS' "$PROJECT_DIR/services/control-api/main.go"
grep -q 'exceeds daily deposit cap' "$PROJECT_DIR/services/control-api/internal/worker/escrow_listener.go"
echo SOURCES_OK

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building control-api"
"${COMPOSE[@]}" build control-api

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Recreating control-api"
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

ok=0
for i in $(seq 1 72); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' 2>/dev/null || true)
  echo "try=$i control-api $st"
  if echo "$st" | grep -qi healthy; then
    echo "control-api HEALTHY"
    ok=1
    break
  fi
  sleep 5
done
if [[ "$ok" != "1" ]]; then
  echo "control-api failed healthy" >&2
  "${COMPOSE[@]}" logs --tail=80 control-api || true
  exit 1
fi

if [[ -n "$RECREDIT_SPECS" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Dry-run recredit"
  "${COMPOSE[@]}" run --rm --no-deps \
    -e RECREDIT_DEPOSITS="$RECREDIT_SPECS" \
    -e RECREDIT_DRY_RUN=true \
    control-api || true

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Recredit deposits"
  "${COMPOSE[@]}" run --rm --no-deps \
    -e RECREDIT_DEPOSITS="$RECREDIT_SPECS" \
    -e RECREDIT_DRY_RUN=false \
    control-api
fi

if [[ "$AIRDROP_HOT_SOL" != "0" && -n "$AIRDROP_HOT_SOL" ]]; then
  HOT=$("${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_HOT_ADDRESS | tr -d '\r')
  RPC=$("${COMPOSE[@]}" exec -T control-api printenv SOLANA_RPC_ENDPOINT | tr -d '\r')
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Requesting ${AIRDROP_HOT_SOL} SOL airdrop to hot=$HOT"
  # Devnet airdrop via RPC (may rate-limit; retries below)
  LAMPORTS=$(python3 - <<PY
print(int(float("$AIRDROP_HOT_SOL") * 1_000_000_000))
PY
)
  for attempt in 1 2 3 4 5; do
    RESP=$(curl -sS "$RPC" -H 'Content-Type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"requestAirdrop\",\"params\":[\"$HOT\",$LAMPORTS]}" || true)
    echo "airdrop attempt=$attempt resp=$RESP"
    if echo "$RESP" | grep -q '"result"'; then
      break
    fi
    sleep $((attempt * 3))
  done
  sleep 3
  curl -sS "$RPC" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$HOT\"]}" || true
  echo
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Post-check balances / pending"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT LEFT(reference,16) AS ref, amount, provider, status, created_at FROM pending_transactions WHERE provider LIKE 'blockchain%' ORDER BY created_at DESC LIMIT 8;"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT balance_sol, updated_at FROM wallets WHERE user_id='b77e84c9-0e85-4f23-afc0-581cd561c216';"

echo WALLET_RECOVERY_DONE

