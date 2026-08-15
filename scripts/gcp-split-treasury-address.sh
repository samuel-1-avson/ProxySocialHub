#!/usr/bin/env bash
# Point SOLANA_TREASURY_ADDRESS at the deposit vault PDA (≠ hot payout wallet).
set -euo pipefail
cd "${PROJECT_DIR:-/opt/proxyhubb}"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

VAULT=$(grep -E '^SOLANA_DEPOSIT_VAULT_ADDRESS=' .env | head -1 | cut -d= -f2- | tr -d '\r')
HOT=$(grep -E '^SOLANA_TREASURY_HOT_ADDRESS=' .env | head -1 | cut -d= -f2- | tr -d '\r')
[[ -n "$VAULT" ]] || { echo "SOLANA_DEPOSIT_VAULT_ADDRESS missing"; exit 1; }
[[ -n "$HOT" ]] || { echo "SOLANA_TREASURY_HOT_ADDRESS missing"; exit 1; }
[[ "$VAULT" != "$HOT" ]] || { echo "vault equals hot — abort"; exit 1; }

if grep -q '^SOLANA_TREASURY_ADDRESS=' .env; then
  sed -i "s|^SOLANA_TREASURY_ADDRESS=.*|SOLANA_TREASURY_ADDRESS=${VAULT}|" .env
else
  echo "SOLANA_TREASURY_ADDRESS=${VAULT}" >> .env
fi

"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 40); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "$st" | grep -qi healthy && break
  sleep 3
done
echo "$st" | grep -qi healthy

T=$(grep -E '^SOLANA_TREASURY_ADDRESS=' .env | cut -d= -f2- | tr -d '\r')
H=$(grep -E '^SOLANA_TREASURY_HOT_ADDRESS=' .env | cut -d= -f2- | tr -d '\r')
echo "treasury=$T hot=$H"
[[ "$T" != "$H" ]] || { echo "still equal"; exit 1; }
curl -fsS http://127.0.0.1:8080/v1/system/config/public | head -c 500 || true
echo
echo TREASURY_SPLIT_DONE
