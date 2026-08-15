#!/usr/bin/env bash
# Sprint E inventory: redacted custody/KMS state on the VM (no private key material printed).
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

redact_env() {
  local key="$1"
  local v
  v=$(grep -E "^${key}=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
  if [[ -z "$v" ]]; then
    echo "${key}=<unset>"
  elif [[ ${#v} -gt 12 ]]; then
    echo "${key}=${v:0:8}…${#v}chars"
  else
    echo "${key}=$v"
  fi
}

echo "=== .env flags (booleans / short) ==="
for k in USE_GCP_KMS USE_AWS_KMS PROXYHUB_REQUIRE_GCP_KMS APP_ENV; do
  echo "$k=$(grep -E "^${k}=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || echo '<unset>')"
done

echo "=== addresses (prefix only) ==="
for k in SOLANA_TREASURY_ADDRESS SOLANA_TREASURY_HOT_ADDRESS SOLANA_TREASURY_COLD_ADDRESS SOLANA_DEPOSIT_VAULT_ADDRESS GCP_KMS_PUBLIC_KEY SOLANA_PROGRAM_ID; do
  redact_env "$k"
done

echo "=== GCP_KMS_KEY_NAME (tail) ==="
KN=$(grep -E '^GCP_KMS_KEY_NAME=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
if [[ -n "$KN" ]]; then
  echo "GCP_KMS_KEY_NAME=…/$(basename "$(dirname "$KN")")/$(basename "$KN")"
else
  echo "GCP_KMS_KEY_NAME=<unset>"
fi

echo "=== distinctness ==="
VAULT=$(grep -E '^SOLANA_DEPOSIT_VAULT_ADDRESS=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
TREAS=$(grep -E '^SOLANA_TREASURY_ADDRESS=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
HOT=$(grep -E '^SOLANA_TREASURY_HOT_ADDRESS=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
COLD=$(grep -E '^SOLANA_TREASURY_COLD_ADDRESS=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
ORACLE=$(grep -E '^GCP_KMS_PUBLIC_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
# fallback: derive nothing — just compare known strings
echo "vault_eq_treas=$([ "$VAULT" = "$TREAS" ] && echo yes || echo no)"
echo "vault_eq_hot=$([ -n "$VAULT" ] && [ "$VAULT" = "$HOT" ] && echo yes || echo no)"
echo "hot_eq_oracle=$([ -n "$HOT" ] && [ -n "$ORACLE" ] && [ "$HOT" = "$ORACLE" ] && echo yes || echo no)"
echo "cold_eq_hot=$([ -n "$COLD" ] && [ "$COLD" = "$HOT" ] && echo yes || echo no)"
echo "cold_eq_oracle=$([ -n "$COLD" ] && [ -n "$ORACLE" ] && [ "$COLD" = "$ORACLE" ] && echo yes || echo no)"
echo "treas_eq_oracle=$([ -n "$TREAS" ] && [ -n "$ORACLE" ] && [ "$TREAS" = "$ORACLE" ] && echo yes || echo no)"

echo "=== container env ==="
"${COMPOSE[@]}" exec -T control-api printenv USE_GCP_KMS 2>/dev/null | tr -d '\r' || echo "USE_GCP_KMS=<no-container>"
"${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_REQUIRE_GCP_KMS 2>/dev/null | tr -d '\r' || true

echo "=== mounts (paths only) ==="
sudo docker inspect proxyhubb-control-api-1 --format '{{range .Mounts}}{{.Destination}} {{end}}' 2>/dev/null || true
"${COMPOSE[@]}" exec -T control-api sh -c 'ls /run/secrets 2>/dev/null; ls /secrets 2>/dev/null; true' || true

echo "=== recent KMS/oracle log lines ==="
sudo docker logs proxyhubb-control-api-1 2>&1 | grep -iE 'GCP Cloud KMS|MockHSM|oracle signer|KMS|custody|Initialized' | tail -30 || true

echo "INVENTORY_OK"
