#!/usr/bin/env bash
# Root inventory — redacted; no private key file contents.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== .env flags ==="
for k in USE_GCP_KMS USE_AWS_KMS PROXYHUB_REQUIRE_GCP_KMS APP_ENV; do
  echo "$k=$(grep -E "^${k}=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || echo '<unset>')"
done

echo "=== address prefixes ==="
for k in SOLANA_TREASURY_ADDRESS SOLANA_TREASURY_HOT_ADDRESS SOLANA_TREASURY_COLD_ADDRESS SOLANA_DEPOSIT_VAULT_ADDRESS GCP_KMS_PUBLIC_KEY; do
  v=$(grep -E "^${k}=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
  if [[ -z "$v" ]]; then echo "$k=<unset>"; else echo "$k=${v:0:8}… len=${#v}"; fi
done

VAULT=$(grep -E '^SOLANA_DEPOSIT_VAULT_ADDRESS=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
TREAS=$(grep -E '^SOLANA_TREASURY_ADDRESS=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
HOT=$(grep -E '^SOLANA_TREASURY_HOT_ADDRESS=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
COLD=$(grep -E '^SOLANA_TREASURY_COLD_ADDRESS=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
ORACLE=$(grep -E '^GCP_KMS_PUBLIC_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
# Also from container if .env incomplete
C_VAULT=$("${COMPOSE[@]}" exec -T control-api printenv SOLANA_DEPOSIT_VAULT_ADDRESS 2>/dev/null | tr -d '\r' || true)
C_TREAS=$("${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_ADDRESS 2>/dev/null | tr -d '\r' || true)
C_HOT=$("${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_HOT_ADDRESS 2>/dev/null | tr -d '\r' || true)
C_COLD=$("${COMPOSE[@]}" exec -T control-api printenv SOLANA_TREASURY_COLD_ADDRESS 2>/dev/null | tr -d '\r' || true)
C_KMS=$("${COMPOSE[@]}" exec -T control-api printenv USE_GCP_KMS 2>/dev/null | tr -d '\r' || true)
C_REQ=$("${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_REQUIRE_GCP_KMS 2>/dev/null | tr -d '\r' || true)

VAULT=${VAULT:-$C_VAULT}
TREAS=${TREAS:-$C_TREAS}
HOT=${HOT:-$C_HOT}
COLD=${COLD:-$C_COLD}

echo "=== container flags ==="
echo "USE_GCP_KMS=$C_KMS"
echo "PROXYHUB_REQUIRE_GCP_KMS=$C_REQ"

echo "=== distinctness (container+env) ==="
echo "vault_prefix=${VAULT:0:8}"
echo "treas_prefix=${TREAS:0:8}"
echo "hot_prefix=${HOT:0:8}"
echo "cold_prefix=${COLD:0:8}"
echo "oracle_prefix=${ORACLE:0:8}"
[[ -n "$VAULT" && -n "$TREAS" && "$VAULT" == "$TREAS" ]] && echo "PASS vault==treasury_address" || echo "FAIL vault!=treasury_address (or unset)"
[[ -n "$VAULT" && -n "$HOT" && "$VAULT" != "$HOT" ]] && echo "PASS vault!=hot" || echo "FAIL vault==hot or unset"
[[ -n "$HOT" && -n "$ORACLE" && "$HOT" != "$ORACLE" ]] && echo "PASS hot!=oracle" || echo "WARN hot/oracle compare (oracle may only be in logs)"
[[ -z "$COLD" || ( -n "$HOT" && "$COLD" != "$HOT" ) ]] && echo "PASS cold ok" || echo "FAIL cold==hot"
[[ -z "$COLD" || ( -n "$ORACLE" && "$COLD" != "$ORACLE" ) ]] && echo "PASS cold!=oracle or unset" || echo "FAIL cold==oracle"

echo "=== cold not in container mounts ==="
MOUNTS=$(docker inspect proxyhubb-control-api-1 --format '{{range .Mounts}}{{.Destination}};{{end}}')
echo "mounts=$MOUNTS"
echo "$MOUNTS" | grep -qi cold && echo "FAIL cold mounted" || echo "PASS cold not mounted"

echo "=== public config deposit/treasury hints ==="
curl -fsS --max-time 10 http://127.0.0.1:8080/v1/system/config/public 2>/dev/null | head -c 800 || \
  curl -fsS --max-time 10 http://127.0.0.1:18080/v1/system/config/public 2>/dev/null | head -c 800 || echo "(no public config)"
echo

echo "ROOT_INVENTORY_OK"
