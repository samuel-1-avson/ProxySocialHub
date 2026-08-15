#!/usr/bin/env bash
# Deploy treasury liquidity automation (vault->hot, withdraw queue, caps, cold proposals).
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?}"
DOCKER="${DOCKER:-docker}"
cd "$PROJECT_DIR"

tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"

[[ -d "$tmpdir/control-api" ]] && cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
if [[ -d "$tmpdir/migrations" ]]; then
  cp -a "$tmpdir/migrations/." "$PROJECT_DIR/migrations/"
fi
for f in docker-compose.yml docker-compose.gcp-testnet.yml docker-compose.dev.yml; do
  [[ -f "$tmpdir/$f" ]] && cp -a "$tmpdir/$f" "$PROJECT_DIR/$f"
done
[[ -d "$tmpdir/web" ]] && cp -a "$tmpdir/web/." "$PROJECT_DIR/apps/web/"
# Do not overwrite running deploy scripts from the tarball.
rm -rf "$tmpdir"

strip_cr() {
  local f="$1"
  local tmpf
  tmpf=$(mktemp)
  tr -d '\015' < "$f" > "$tmpf" && mv "$tmpf" "$f"
}

find "$PROJECT_DIR/services/control-api" -type f -name '*.go' -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do strip_cr "$f"; done
find "$PROJECT_DIR/migrations" -type f -name '*.sql' -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do strip_cr "$f"; done
for f in docker-compose.yml docker-compose.gcp-testnet.yml docker-compose.dev.yml; do
  [[ -f "$PROJECT_DIR/$f" ]] && strip_cr "$PROJECT_DIR/$f"
done

test -f "$PROJECT_DIR/migrations/000133_withdrawal_payout_queue.up.sql"
grep -q 'EnsureHotLiquidity' "$PROJECT_DIR/services/control-api/internal/treasury/treasury_manager.go"
grep -q 'withdrawal_payout_queue' "$PROJECT_DIR/services/control-api/internal/models/withdrawal_payout.go"
grep -q 'StartWithdrawalPayoutWorker' "$PROJECT_DIR/services/control-api/main.go"
grep -q 'SOLANA_TREASURY_HOT_MIN_BALANCE' "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
echo SOURCES_OK

# DOCKER must be a single token (e.g. docker). Run this script under sudo if needed.
COMPOSE=("$DOCKER" compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

for i in $(seq 1 60); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i $st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done
echo "$st" | grep -qi healthy

echo "=== apply migration 000133 ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb \
  < "$PROJECT_DIR/migrations/000133_withdrawal_payout_queue.up.sql"

echo "=== verify table ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c '\d withdrawal_payout_queue'

echo "=== container treasury env ==="
"${COMPOSE[@]}" exec -T control-api printenv APP_ENV
"${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_HOT_MIN_BALANCE || true
"${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_REPLENISH_AMOUNT || true
"${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_HOT_MAX_BALANCE || true
"${COMPOSE[@]}" exec -T control-api printenv SOLANA_VAULT_TOPUP_MAX_SOL || true
"${COMPOSE[@]}" exec -T control-api printenv SOLANA_VAULT_DAILY_TOPUP_CAP_SOL || true

echo "=== public treasury sample ==="
curl -sS http://127.0.0.1:18080/v1/treasury/public | head -c 2000; echo

echo "=== worker boot logs ==="
"$DOCKER" logs proxyhubb-control-api-1 2>&1 \
  | grep -E 'Withdrawal payout worker|Treasury auto-topup|Vault|Cold' \
  | tail -n 20 || true

echo LIQUIDITY_AUTOMATION_DEPLOY_DONE
