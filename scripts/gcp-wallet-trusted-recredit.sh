#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR=/opt/proxyhubb
DEPLOY_TAR="${DEPLOY_TAR:?}"
DOCKER=docker
cd "$PROJECT_DIR"
tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"
cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
rm -rf "$tmpdir"
find "$PROJECT_DIR/services/control-api" -name '*.go' -exec sed -i 's/\r$//' {} +
grep -q RecreditDepositsOpts "$PROJECT_DIR/services/control-api/internal/ops/recredit_deposits.go"
COMPOSE=($DOCKER compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 36); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i $st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done
SPECS='3V6mEq7HRBiZmk4Q98CotYQSR6wMvFQRuJDDNtSuJe69RGCojSRhxKKUNkvGKs3BBroYY7yU3tU4fkv1HjvrakEq:500000000:62vwX11TCForSbpExYz7sp2b6AkWy7urDgYHcERt2eE,yuvxVUpcK3h1B6HPtJa14A8MDGD2Jrp2jvLWvQGxRUR6SwU3UvRr2yDPTtLX8KuPF1CeakRXBMS5GZVzLBx4FCe:100000000:62vwX11TCForSbpExYz7sp2b6AkWy7urDgYHcERt2eE'
echo '=== trusted recredit ==='
"${COMPOSE[@]}" run --rm --no-deps \
  -e RECREDIT_DEPOSITS="$SPECS" \
  -e RECREDIT_TRUST_CLI=true \
  -e RECREDIT_DRY_RUN=false \
  control-api
HOT=$("${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_HOT_ADDRESS | tr -d '\r')
RPC=$("${COMPOSE[@]}" exec -T control-api printenv SOLANA_RPC_ENDPOINT | tr -d '\r')
echo "=== airdrop 2 SOL x3 to $HOT ==="
for n in 1 2 3; do
  RESP=$(curl -sS "$RPC" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"requestAirdrop\",\"params\":[\"$HOT\",2000000000]}" || true)
  echo "airdrop $n $RESP"
  sleep 8
done
sleep 3
curl -sS "$RPC" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$HOT\"]}"
echo
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT LEFT(reference,16) ref, amount, provider, status FROM pending_transactions WHERE reference LIKE '3V6m%' OR reference LIKE 'yuvx%';"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT balance_sol, updated_at FROM wallets WHERE user_id='b77e84c9-0e85-4f23-afc0-581cd561c216';"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT COUNT(*) journal_lines FROM ledger_journal_lines;"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT entry_type, LEFT(external_ref,16) ref, created_at FROM ledger_journals ORDER BY created_at DESC LIMIT 4;"
echo DONE

