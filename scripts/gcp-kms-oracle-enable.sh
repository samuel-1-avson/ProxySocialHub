#!/usr/bin/env bash
# Enable USE_GCP_KMS on proxyhubb-testnet control-api.
#
# Usage (on VM as root under /opt/proxyhubb, or via gcloud ssh):
#   GCP_KMS_KEY_NAME=projects/.../cryptoKeyVersions/1 \
#   GCP_KMS_PUBLIC_KEY=8P4uu... \
#   bash scripts/gcp-kms-oracle-enable.sh
set -euo pipefail
cd "${PROJECT_DIR:-/opt/proxyhubb}"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

GCP_KMS_KEY_NAME="${GCP_KMS_KEY_NAME:?set GCP_KMS_KEY_NAME to full cryptoKeyVersions resource}"
GCP_KMS_PUBLIC_KEY="${GCP_KMS_PUBLIC_KEY:?set GCP_KMS_PUBLIC_KEY to Solana base58 pubkey}"

set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

set_env USE_GCP_KMS true
set_env USE_AWS_KMS false
set_env GCP_KMS_KEY_NAME "$GCP_KMS_KEY_NAME"
set_env GCP_KMS_PUBLIC_KEY "$GCP_KMS_PUBLIC_KEY"
set_env PROXYHUB_REQUIRE_GCP_KMS true

# Grant the GCE default SA signer role if PROJECT+SA provided
if [[ -n "${PROJECT:-}" && -n "${RUNTIME_SA:-}" ]]; then
  gcloud kms keys add-iam-policy-binding "$(dirname "$(dirname "$GCP_KMS_KEY_NAME")")" \
    --location="${LOCATION:-us-central1}" \
    --keyring="${KEYRING:-proxyhubb-oracle}" \
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

FLAG=$("${COMPOSE[@]}" exec -T control-api printenv USE_GCP_KMS | tr -d '\r')
[[ "$FLAG" == "true" ]] || { echo "USE_GCP_KMS not true in container"; exit 1; }
echo GCP_KMS_ENABLED
