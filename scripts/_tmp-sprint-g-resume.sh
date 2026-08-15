#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
DOCKER=docker
COMPOSE=($DOCKER compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
VERSION="projects/gen-lang-client-0022105784/locations/us-central1/keyRings/proxyhubb-treasury/cryptoKeys/hot-ed25519/cryptoKeyVersions/2"
HOT_PUB="FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3"
set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}
set_env USE_GCP_KMS_HOT true
set_env GCP_KMS_HOT_KEY_NAME "$VERSION"
set_env GCP_KMS_HOT_PUBLIC_KEY "$HOT_PUB"
set_env PROXYHUB_REQUIRE_GCP_KMS_HOT true
set_env SOLANA_TREASURY_HOT_ADDRESS "$HOT_PUB"
echo "=== rebuild control-api ==="
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 60); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "$st" | grep -qi healthy && break
  sleep 3
done
echo "$st" | grep -qi healthy || { echo FAIL_HEALTH; $DOCKER logs proxyhubb-control-api-1 2>&1 | tail -50; exit 1; }
FLAG=$("${COMPOSE[@]}" exec -T control-api printenv USE_GCP_KMS_HOT | tr -d '\r')
[[ "$FLAG" == "true" ]] || { echo "FAIL FLAG=$FLAG"; exit 1; }
sleep 2
$DOCKER logs proxyhubb-control-api-1 2>&1 | grep -F 'Initialized GCP Cloud KMS hot signer' | tail -3
$DOCKER logs proxyhubb-control-api-1 2>&1 | grep -F 'BC-08 custody split active' | tail -2
echo "=== SendSOL smoke ==="
SMOKE_ENV=/tmp/hot-kms-smoke.env
grep -E '^(USE_GCP_KMS|GCP_KMS_|PROXYHUB_REQUIRE_GCP_KMS|USE_GCP_KMS_HOT|GCP_KMS_HOT_|PROXYHUB_REQUIRE_GCP_KMS_HOT|SOLANA_|APP_ENV)=' .env > "$SMOKE_ENV" || true
grep -q '^USE_GCP_KMS_HOT=true' "$SMOKE_ENV" || echo 'USE_GCP_KMS_HOT=true' >> "$SMOKE_ENV"
grep -q '^PROXYHUB_REQUIRE_GCP_KMS_HOT=true' "$SMOKE_ENV" || echo 'PROXYHUB_REQUIRE_GCP_KMS_HOT=true' >> "$SMOKE_ENV"
echo 'APP_ENV=staging' >> "$SMOKE_ENV"
sed -i '/^SOLANA_TREASURY_HOT_KEYPAIR=/d' "$SMOKE_ENV" || true
$DOCKER run --rm --network host \
  --env-file "$SMOKE_ENV" \
  -v /opt/proxyhubb/services/control-api:/src \
  -w /src \
  golang:1.25-bookworm \
  go run ./cmd/hot-kms-smoke 2>&1 | tee /tmp/hot-kms-smoke.out
grep -q HOT_KMS_SENDSOL_OK /tmp/hot-kms-smoke.out
curl -fsS --max-time 10 -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health
echo SPRINT_G_VERIFY_OK
