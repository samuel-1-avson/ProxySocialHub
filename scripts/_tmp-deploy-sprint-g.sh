#!/usr/bin/env bash
# Sprint G: provision hot KMS (if needed), deploy sources, enable, smoke SendSOL via KMS.
set -euo pipefail
TAR="${1:?usage: $0 /tmp/sprint-g-hot-kms.tar.gz}"
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DOCKER="${DOCKER:-docker}"
PROJECT="${PROJECT:-gen-lang-client-0022105784}"
LOCATION="${LOCATION:-us-central1}"
cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extract $TAR"
tar -xzf "$TAR" -C "$PROJECT_DIR"
find "$PROJECT_DIR/scripts" "$PROJECT_DIR/services/control-api" "$PROJECT_DIR/docs" "$PROJECT_DIR" -maxdepth 4 \
  -type f \( -name '*.sh' -o -name '*.yml' -o -name '*.go' -o -name '*.md' -o -name '*.example' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true
chmod +x "$PROJECT_DIR/scripts/"gcp-kms-hot-*.sh 2>/dev/null || true

COMPOSE=("$DOCKER" compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

# Runtime SA for IAM
RUNTIME_SA=$(curl -fsS -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email 2>/dev/null || true)
echo "RUNTIME_SA=${RUNTIME_SA:-unknown}"

echo "=== provision hot KMS (idempotent if key exists) ==="
HOT_KP="${HOT_KP:-/opt/proxyhubb/secrets/treasury-hot-keypair.json}"
export PROJECT LOCATION KEYRING=proxyhubb-treasury KEY=hot-ed25519
export HOT_KP EXPECT_PUBKEY=FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3
# Prefer already-enabled version if present
EXISTING=$(gcloud kms keys versions list \
  --key=hot-ed25519 --keyring=proxyhubb-treasury --location="$LOCATION" --project="$PROJECT" \
  --filter="state=ENABLED" --format="value(name)" 2>/dev/null | head -1 || true)
if [[ -n "$EXISTING" ]]; then
  echo "HOT_KMS_ALREADY=$EXISTING"
  VERSION="$EXISTING"
else
  bash "$PROJECT_DIR/scripts/gcp-kms-hot-provision.sh" | tee /tmp/hot-provision.out
  VERSION=$(grep '^KEY_VERSION=' /tmp/hot-provision.out | tail -1 | cut -d= -f2-)
fi
[[ -n "${VERSION:-}" ]] || { echo "FAIL: no hot KMS version"; exit 1; }
echo "HOT_VERSION=$VERSION"

# IAM for signer
if [[ -n "$RUNTIME_SA" ]]; then
  gcloud kms keys add-iam-policy-binding hot-ed25519 \
    --keyring=proxyhubb-treasury \
    --location="$LOCATION" \
    --project="$PROJECT" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/cloudkms.signerVerifier" || true
fi

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
set_env GCP_KMS_HOT_PUBLIC_KEY "FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3"
set_env PROXYHUB_REQUIRE_GCP_KMS_HOT true
set_env SOLANA_TREASURY_HOT_ADDRESS "FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3"

echo "=== rebuild control-api ==="
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 50); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "$st" | grep -qi healthy && break
  sleep 3
done
echo "$st" | grep -qi healthy || { echo "FAIL: control-api not healthy"; "$DOCKER" logs proxyhubb-control-api-1 2>&1 | tail -40; exit 1; }

FLAG=$("${COMPOSE[@]}" exec -T control-api printenv USE_GCP_KMS_HOT | tr -d '\r')
[[ "$FLAG" == "true" ]] || { echo "FAIL USE_GCP_KMS_HOT=$FLAG"; exit 1; }

echo "=== KMS hot log assert ==="
sleep 2
"$DOCKER" logs proxyhubb-control-api-1 2>&1 | grep -F 'Initialized GCP Cloud KMS hot signer' | tail -3
"$DOCKER" logs proxyhubb-control-api-1 2>&1 | grep -F 'BC-08 custody split active' | tail -2

echo "=== SendSOL smoke via hot KMS ==="
# Copy env into a golang container with ADC (GCE metadata) + host network.
SMOKE_ENV=/tmp/hot-kms-smoke.env
grep -E '^(USE_GCP_KMS|GCP_KMS_|PROXYHUB_REQUIRE_GCP_KMS|USE_GCP_KMS_HOT|GCP_KMS_HOT_|PROXYHUB_REQUIRE_GCP_KMS_HOT|SOLANA_|APP_ENV)=' .env > "$SMOKE_ENV" || true
# Ensure hot KMS flags present
grep -q '^USE_GCP_KMS_HOT=true' "$SMOKE_ENV" || echo 'USE_GCP_KMS_HOT=true' >> "$SMOKE_ENV"
grep -q '^PROXYHUB_REQUIRE_GCP_KMS_HOT=true' "$SMOKE_ENV" || echo 'PROXYHUB_REQUIRE_GCP_KMS_HOT=true' >> "$SMOKE_ENV"
echo 'APP_ENV=staging' >> "$SMOKE_ENV"
# Clear file hot path so smoke proves KMS-only path
sed -i '/^SOLANA_TREASURY_HOT_KEYPAIR=/d' "$SMOKE_ENV" || true

"$DOCKER" run --rm --network host \
  --env-file "$SMOKE_ENV" \
  -v "$PROJECT_DIR/services/control-api:/src" \
  -w /src \
  golang:1.25-bookworm \
  go run ./cmd/hot-kms-smoke 2>&1 | tee /tmp/hot-kms-smoke.out
grep -q HOT_KMS_SENDSOL_OK /tmp/hot-kms-smoke.out || { echo "FAIL: SendSOL smoke"; exit 1; }

curl -fsS --max-time 10 -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health
echo "SPRINT_G_VERIFY_OK"
