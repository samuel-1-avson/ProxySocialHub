#!/usr/bin/env bash
# Sprint H: quarantine oracle/hot private key JSON off the app runtime path.
# Requires USE_GCP_KMS + USE_GCP_KMS_HOT + REQUIRE already healthy.
set -euo pipefail
cd /opt/proxyhubb

DC=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "== preflight KMS =="
"${DC[@]}" exec -T control-api printenv USE_GCP_KMS PROXYHUB_REQUIRE_GCP_KMS USE_GCP_KMS_HOT PROXYHUB_REQUIRE_GCP_KMS_HOT
"${DC[@]}" logs control-api 2>&1 | grep -E "Initialized GCP Cloud KMS" | tail -5

QUARANTINE_DIR="/opt/proxyhubb/secrets/quarantine-$(date -u +%Y%m%d)"
sudo mkdir -p "$QUARANTINE_DIR"
sudo chmod 700 "$QUARANTINE_DIR"

move_if_present() {
  local src="$1"
  if [ -f "$src" ]; then
    echo "quarantine $src -> $QUARANTINE_DIR/"
    sudo mv -f "$src" "$QUARANTINE_DIR/"
  else
    echo "skip (missing): $src"
  fi
}

move_if_present /opt/proxyhubb/secrets/treasury-hot-keypair.json
move_if_present /opt/proxyhubb/infra/oracle-keypair.json
# Also catch compose-relative paths if different
move_if_present ./secrets/treasury-hot-keypair.json
move_if_present ./infra/oracle-keypair.json

echo "QUARANTINE_DIR=$QUARANTINE_DIR"
echo "KEYFILE_QUARANTINE_OK"
