#!/usr/bin/env bash
# Hot-KMS SendSOL smoke with Redis (velocity guard).
set -euo pipefail
cd /opt/proxyhubb

DC=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

get() { "${DC[@]}" exec -T control-api printenv "$1" 2>/dev/null || true; }

HOT_ADDR="$(get SOLANA_TREASURY_HOT_ADDRESS)"
HOT_KMS_NAME="$(get GCP_KMS_HOT_KEY_NAME)"
HOT_KMS_PUB="$(get GCP_KMS_HOT_PUBLIC_KEY)"
ORACLE_KMS_NAME="$(get GCP_KMS_KEY_NAME)"
ORACLE_KMS_PUB="$(get GCP_KMS_PUBLIC_KEY)"
# Prefer public Solana RPC for smoke (avoid OnFinality rate limits on shared key).
RPC="${SMOKE_SOLANA_RPC_URL:-https://api.devnet.solana.com}"
REDIS_URL="$(get REDIS_URL)"
NETWORK="$(sudo docker inspect proxyhubb-control-api-1 --format '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | head -1)"

echo "hot_addr=${HOT_ADDR:-EMPTY}"
echo "hot_kms=${HOT_KMS_NAME:-EMPTY}"
echo "oracle_kms=${ORACLE_KMS_NAME:-EMPTY}"
echo "rpc=${RPC:-EMPTY}"
echo "network=${NETWORK:-EMPTY}"

test -n "$HOT_ADDR"
test -n "$HOT_KMS_NAME"
test -n "$HOT_KMS_PUB"
test -n "$ORACLE_KMS_NAME"
test -n "$ORACLE_KMS_PUB"
test -n "$RPC"
test -n "$REDIS_URL"
test -n "$NETWORK"

echo "redis_set=yes"

sudo docker run --rm --network "$NETWORK" \
  -e SOLANA_NETWORK=devnet \
  -e SOLANA_RPC_URL="$RPC" \
  -e REDIS_URL="$REDIS_URL" \
  -e USE_GCP_KMS=true \
  -e PROXYHUB_REQUIRE_GCP_KMS=true \
  -e GCP_KMS_KEY_NAME="$ORACLE_KMS_NAME" \
  -e GCP_KMS_PUBLIC_KEY="$ORACLE_KMS_PUB" \
  -e USE_GCP_KMS_HOT=true \
  -e PROXYHUB_REQUIRE_GCP_KMS_HOT=true \
  -e GCP_KMS_HOT_KEY_NAME="$HOT_KMS_NAME" \
  -e GCP_KMS_HOT_PUBLIC_KEY="$HOT_KMS_PUB" \
  -e SOLANA_TREASURY_HOT_ADDRESS="$HOT_ADDR" \
  -e GOTOOLCHAIN=auto \
  -v /opt/proxyhubb/services/control-api:/src \
  -w /src \
  golang:1.25-bookworm \
  go run ./cmd/hot-kms-smoke

echo "SPRINT_G_VERIFY_OK"
