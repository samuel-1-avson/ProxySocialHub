#!/usr/bin/env bash
# Deploy GCP KMS custody cutover on proxyhubb-testnet.
# Usage: DEPLOY_TAR=/tmp/gcp-kms-custody-....tar.gz bash /tmp/deploy-kms-custody.sh
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?}"
cd "$PROJECT_DIR"

tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"
[[ -d "$tmpdir/control-api" ]] && cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
for f in docker-compose.yml docker-compose.gcp-testnet.yml; do
  [[ -f "$tmpdir/$f" ]] && cp -a "$tmpdir/$f" "$PROJECT_DIR/$f"
done
mkdir -p "$PROJECT_DIR/scripts"
[[ -d "$tmpdir/scripts" ]] && cp -a "$tmpdir/scripts/." "$PROJECT_DIR/scripts/"
rm -rf "$tmpdir"

strip_cr() { local f="$1" t; t=$(mktemp); tr -d '\015' < "$f" > "$t" && mv "$t" "$f"; }
find "$PROJECT_DIR/services/control-api" -type f -name '*.go' -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do strip_cr "$f"; done
for f in docker-compose.yml docker-compose.gcp-testnet.yml scripts/gcp-kms-oracle-enable.sh scripts/gcp-split-treasury-address.sh; do
  [[ -f "$PROJECT_DIR/$f" ]] && strip_cr "$PROJECT_DIR/$f"
done

grep -q 'USE_GCP_KMS' "$PROJECT_DIR/services/control-api/internal/solana/client.go"
grep -q 'NewGCPKMSSigner' "$PROJECT_DIR/services/control-api/internal/solana/kms_gcp.go"
grep -q 'custodial balance_sol settle disabled' "$PROJECT_DIR/services/control-api/internal/settlement/intent.go"
echo SOURCES_OK

set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

VAULT=$(grep -E '^SOLANA_DEPOSIT_VAULT_ADDRESS=' .env | head -1 | cut -d= -f2- | tr -d '\r')
HOT=$(grep -E '^SOLANA_TREASURY_HOT_ADDRESS=' .env | head -1 | cut -d= -f2- | tr -d '\r')
[[ -n "$VAULT" && -n "$HOT" && "$VAULT" != "$HOT" ]] || { echo "vault/hot missing or equal"; exit 1; }
set_env SOLANA_TREASURY_ADDRESS "$VAULT"

GCP_KMS_KEY_NAME="${GCP_KMS_KEY_NAME:-projects/gen-lang-client-0022105784/locations/us-central1/keyRings/proxyhubb-oracle/cryptoKeys/oracle-ed25519/cryptoKeyVersions/1}"
GCP_KMS_PUBLIC_KEY="${GCP_KMS_PUBLIC_KEY:-8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2}"
set_env USE_GCP_KMS true
set_env USE_AWS_KMS false
set_env GCP_KMS_KEY_NAME "$GCP_KMS_KEY_NAME"
set_env GCP_KMS_PUBLIC_KEY "$GCP_KMS_PUBLIC_KEY"
set_env PROXYHUB_REQUIRE_GCP_KMS true

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

for i in $(seq 1 60); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i $st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done
echo "$st" | grep -qi healthy

echo "=== flags ==="
"${COMPOSE[@]}" exec -T control-api sh -c 'printenv USE_GCP_KMS GCP_KMS_PUBLIC_KEY PROXYHUB_REQUIRE_SESSION_PDA SOLANA_TREASURY_ADDRESS SOLANA_TREASURY_HOT_ADDRESS' | tr -d '\r'
curl -fsS http://127.0.0.1:8080/v1/system/config/public | head -c 600 || true
echo
echo KMS_CUSTODY_DEPLOY_DONE
