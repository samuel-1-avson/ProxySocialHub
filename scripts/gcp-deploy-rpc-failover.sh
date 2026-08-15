#!/usr/bin/env bash
# Wire multi-RPC failover + redeploy control-api (fixes deposit/withdraw 429s).
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?}"
DOCKER="${DOCKER:-docker}"
cd "$PROJECT_DIR"

tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"
cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
[[ -d "$tmpdir/scripts" ]] && cp -a "$tmpdir/scripts/." "$PROJECT_DIR/scripts/"
rm -rf "$tmpdir"
find "$PROJECT_DIR/services/control-api" -name '*.go' -exec sed -i 's/\r$//' {} +
grep -q 'rate limit' "$PROJECT_DIR/services/control-api/internal/solana/verify.go"
grep -q '2500 \* time.Millisecond' "$PROJECT_DIR/services/control-api/internal/solana/client.go"
echo SOURCES_OK

ENV_FILE="$PROJECT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  cp -a "$ENV_FILE" "$ENV_FILE.bak.rpc-$(date -u +%Y%m%d%H%M%S)"
  # Prefer OnFinality public, then official (Ankr free tier now requires API key).
  NEW_ENDPOINTS='https://solana-devnet.api.onfinality.io/public,https://api.devnet.solana.com'
  if grep -q '^SOLANA_RPC_ENDPOINTS=' "$ENV_FILE"; then
    sed -i "s|^SOLANA_RPC_ENDPOINTS=.*|SOLANA_RPC_ENDPOINTS=${NEW_ENDPOINTS}|" "$ENV_FILE"
  else
    echo "SOLANA_RPC_ENDPOINTS=${NEW_ENDPOINTS}" >> "$ENV_FILE"
  fi
  if grep -q '^SOLANA_RPC_ENDPOINT=' "$ENV_FILE"; then
    sed -i 's|^SOLANA_RPC_ENDPOINT=.*|SOLANA_RPC_ENDPOINT=https://solana-devnet.api.onfinality.io/public|' "$ENV_FILE"
  else
    echo 'SOLANA_RPC_ENDPOINT=https://solana-devnet.api.onfinality.io/public' >> "$ENV_FILE"
  fi
  echo "Updated RPC endpoints in .env"
  grep -E '^SOLANA_RPC_' "$ENV_FILE" || true
fi

COMPOSE=("$DOCKER" compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 48); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i $st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done
echo "$st" | grep -qi healthy

echo '=== RPC env in container ==='
"${COMPOSE[@]}" exec -T control-api printenv SOLANA_RPC_ENDPOINT
"${COMPOSE[@]}" exec -T control-api printenv SOLANA_RPC_ENDPOINTS

echo '=== smoke treasury public ==='
curl -sS http://127.0.0.1:18080/v1/treasury/public | head -c 900; echo

HOT=$("${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_HOT_ADDRESS | tr -d '\r')
echo "=== balance via ankr for $HOT ==="
curl -sS https://rpc.ankr.com/solana_devnet -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$HOT\"]}" || true
echo
echo RPC_FAILOVER_DONE

