#!/usr/bin/env bash
# Enable USE_GCP_KMS_HOT on proxyhubb-testnet control-api.
#
# Usage (on VM as root under /opt/proxyhubb):
#   GCP_KMS_HOT_KEY_NAME=projects/.../cryptoKeyVersions/1 \
#   GCP_KMS_HOT_PUBLIC_KEY=Feunr... \
#   bash scripts/gcp-kms-hot-enable.sh
set -euo pipefail
cd "${PROJECT_DIR:-/opt/proxyhubb}"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

GCP_KMS_HOT_KEY_NAME="${GCP_KMS_HOT_KEY_NAME:?set GCP_KMS_HOT_KEY_NAME to full cryptoKeyVersions resource}"
GCP_KMS_HOT_PUBLIC_KEY="${GCP_KMS_HOT_PUBLIC_KEY:?set GCP_KMS_HOT_PUBLIC_KEY to Solana base58 pubkey}"

set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

set_env USE_GCP_KMS_HOT true
set_env GCP_KMS_HOT_KEY_NAME "$GCP_KMS_HOT_KEY_NAME"
set_env GCP_KMS_HOT_PUBLIC_KEY "$GCP_KMS_HOT_PUBLIC_KEY"
set_env PROXYHUB_REQUIRE_GCP_KMS_HOT true
# Keep address aligned with KMS pubkey
set_env SOLANA_TREASURY_HOT_ADDRESS "$GCP_KMS_HOT_PUBLIC_KEY"

if [[ -n "${PROJECT:-}" && -n "${RUNTIME_SA:-}" ]]; then
  gcloud kms keys add-iam-policy-binding "$(dirname "$(dirname "$GCP_KMS_HOT_KEY_NAME")")" \
    --location="${LOCATION:-us-central1}" \
    --keyring="${KEYRING:-proxyhubb-treasury}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/cloudkms.signerVerifier" \
    --project="$PROJECT" || true
fi

"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 40); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "$st" | grep -qi healthy && break
  sleep 3
done
echo "$st" | grep -qi healthy

FLAG=$("${COMPOSE[@]}" exec -T control-api printenv USE_GCP_KMS_HOT | tr -d '\r')
[[ "$FLAG" == "true" ]] || { echo "USE_GCP_KMS_HOT not true in container"; exit 1; }
echo GCP_KMS_HOT_ENABLED
