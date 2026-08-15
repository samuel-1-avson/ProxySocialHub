#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
DOCKER=docker
COMPOSE=($DOCKER compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

get() { "${COMPOSE[@]}" exec -T control-api printenv "$1" 2>/dev/null | tr -d '\r' || true; }

HOT_NAME=$(get GCP_KMS_HOT_KEY_NAME)
HOT_PUB=$(get GCP_KMS_HOT_PUBLIC_KEY)
ORACLE_NAME=$(get GCP_KMS_KEY_NAME)
ORACLE_PUB=$(get GCP_KMS_PUBLIC_KEY)
RPC=$(get SOLANA_RPC_URL)
[[ -z "$RPC" ]] && RPC=https://api.devnet.solana.com

echo "oracle_kms_set=$([ -n "$ORACLE_NAME" ] && echo yes || echo no) hot_kms_set=$([ -n "$HOT_NAME" ] && echo yes || echo no)"
[[ -n "$HOT_NAME" && -n "$HOT_PUB" ]] || { echo "FAIL: hot KMS env missing"; exit 1; }
[[ -n "$ORACLE_NAME" && -n "$ORACLE_PUB" ]] || { echo "FAIL: oracle KMS env missing"; exit 1; }

SMOKE_ENV=/tmp/hot-kms-smoke.env
cat > "$SMOKE_ENV" <<EOF
APP_ENV=development
USE_GCP_KMS=true
USE_AWS_KMS=false
PROXYHUB_REQUIRE_GCP_KMS=true
GCP_KMS_KEY_NAME=$ORACLE_NAME
GCP_KMS_PUBLIC_KEY=$ORACLE_PUB
USE_GCP_KMS_HOT=true
PROXYHUB_REQUIRE_GCP_KMS_HOT=true
GCP_KMS_HOT_KEY_NAME=$HOT_NAME
GCP_KMS_HOT_PUBLIC_KEY=$HOT_PUB
SOLANA_TREASURY_HOT_ADDRESS=$HOT_PUB
SOLANA_RPC_URL=$RPC
EOF

echo "=== smoke (KMS oracle + KMS hot, no file hot) ==="
$DOCKER run --rm --network host \
  --env-file "$SMOKE_ENV" \
  -v /opt/proxyhubb/services/control-api:/src \
  -w /src \
  golang:1.25-bookworm \
  go run ./cmd/hot-kms-smoke 2>&1 | tee /tmp/hot-kms-smoke.out
grep -q HOT_KMS_SENDSOL_OK /tmp/hot-kms-smoke.out
curl -fsS --max-time 10 -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health
echo SPRINT_G_VERIFY_OK
