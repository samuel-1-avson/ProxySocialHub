#!/usr/bin/env bash
# BC-08 live custody split recheck (vault ≠ hot ≠ oracle ≠ cold).
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

stamp=$(date -u +%Y%m%dT%H%M%SZ)
fail=0
pass=0
check() {
  local name="$1" ok="$2" detail="${3:-}"
  if [[ "$ok" == "1" ]]; then
    echo "PASS  $name ${detail}"
    pass=$((pass+1))
  else
    echo "FAIL  $name ${detail}"
    fail=$((fail+1))
  fi
}

echo "=== BC-08 custody recheck $stamp ==="

# Public config
pub=$("${COMPOSE[@]}" exec -T control-api wget -qO- http://127.0.0.1:8080/v1/system/config/public 2>/dev/null || true)
echo "public_config_snip=$(echo "$pub" | head -c 500)"

# Env from running container
envdump=$("${COMPOSE[@]}" exec -T control-api sh -c 'env | grep -E "^(SOLANA_TREASURY|SOLANA_DEPOSIT|PROXYHUB_DEPOSIT|USE_GCP_KMS|PROXYHUB_REQUIRE_GCP|APP_ENV|SOLANA_ORACLE)" | sort' || true)
echo "$envdump"

vault=$(echo "$envdump" | sed -n 's/^SOLANA_DEPOSIT_VAULT_ADDRESS=//p' | head -1)
hot=$(echo "$envdump" | sed -n 's/^SOLANA_TREASURY_HOT_ADDRESS=//p' | head -1)
cold=$(echo "$envdump" | sed -n 's/^SOLANA_TREASURY_COLD_ADDRESS=//p' | head -1)
legacy=$(echo "$envdump" | sed -n 's/^SOLANA_TREASURY_ADDRESS=//p' | head -1)
oracle_pub=$(echo "$envdump" | sed -n 's/^GCP_KMS_PUBLIC_KEY=//p' | head -1)
# Fallback: known live oracle if pubkey not in env as base58
if [[ -z "$oracle_pub" || ${#oracle_pub} -lt 32 ]]; then
  oracle_pub=8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2
fi

vault_ui=$(echo "$envdump" | sed -n 's/^PROXYHUB_DEPOSIT_VAULT_UI=//p' | head -1)
vault_credit=$(echo "$envdump" | sed -n 's/^PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED=//p' | head -1)
legacy_credit=$(echo "$envdump" | sed -n 's/^PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT=//p' | head -1)
kms=$(echo "$envdump" | sed -n 's/^USE_GCP_KMS=//p' | head -1)
kms_hot=$(echo "$envdump" | sed -n 's/^USE_GCP_KMS_HOT=//p' | head -1)
req_kms=$(echo "$envdump" | sed -n 's/^PROXYHUB_REQUIRE_GCP_KMS=//p' | head -1)
req_hot=$(echo "$envdump" | sed -n 's/^PROXYHUB_REQUIRE_GCP_KMS_HOT=//p' | head -1)

[[ -n "$vault" && -n "$hot" ]] && check "vault_and_hot_set" 1 "vault=$vault hot=$hot" || check "vault_and_hot_set" 0
[[ "$vault" != "$hot" ]] && check "vault_ne_hot" 1 || check "vault_ne_hot" 0
[[ "$vault" != "$oracle_pub" ]] && check "vault_ne_oracle" 1 || check "vault_ne_oracle" 0
[[ "$hot" != "$oracle_pub" ]] && check "hot_ne_oracle" 1 || check "hot_ne_oracle" 0
if [[ -n "$cold" ]]; then
  [[ "$cold" != "$hot" && "$cold" != "$oracle_pub" && "$cold" != "$vault" ]] && check "cold_distinct" 1 "cold=$cold" || check "cold_distinct" 0
else
  check "cold_set" 0 "SOLANA_TREASURY_COLD_ADDRESS empty"
fi
[[ "$legacy" == "$vault" || "$legacy" != "$hot" ]] && check "legacy_not_hot" 1 "legacy=$legacy" || check "legacy_not_hot" 0

truthy() { case "${1,,}" in 1|true|yes|on) return 0;; *) return 1;; esac; }
truthy "$vault_ui" && check "vault_ui_on" 1 || check "vault_ui_on" 0 "got=$vault_ui"
truthy "$vault_credit" && check "vault_credit_on" 1 || check "vault_credit_on" 0 "got=$vault_credit"
truthy "$legacy_credit" && check "legacy_credit_off" 0 "still true" || check "legacy_credit_off" 1 "got=$legacy_credit"
truthy "$kms" && check "gcp_kms_oracle" 1 || check "gcp_kms_oracle" 0
truthy "$kms_hot" && check "gcp_kms_hot" 1 || check "gcp_kms_hot" 0
truthy "$req_kms" && check "require_gcp_kms" 1 || check "require_gcp_kms" 0
truthy "$req_hot" && check "require_gcp_kms_hot" 1 || check "require_gcp_kms_hot" 0

# Align script must stay gated
if grep -q 'ALLOW_ALIGN_TREASURY_TO_ORACLE' scripts/gcp-align-treasury-to-oracle.sh 2>/dev/null; then
  check "align_script_gated" 1
else
  check "align_script_gated" 0
fi

# No file keypaths mounted for oracle/hot in container
kp=$("${COMPOSE[@]}" exec -T control-api sh -c 'echo ORACLE_KP=$SOLANA_ORACLE_KEYPAIR; echo HOT_KP=$SOLANA_TREASURY_HOT_KEYPAIR; ls -la "$SOLANA_ORACLE_KEYPAIR" 2>/dev/null || true; ls -la "$SOLANA_TREASURY_HOT_KEYPAIR" 2>/dev/null || true' || true)
echo "$kp"
# empty path or missing file is PASS for KMS-only
oracle_kp=$(echo "$kp" | sed -n 's/^ORACLE_KP=//p' | head -1)
hot_kp=$(echo "$kp" | sed -n 's/^HOT_KP=//p' | head -1)
[[ -z "$oracle_kp" || "$oracle_kp" == "" ]] && check "no_oracle_file_kp" 1 "empty path" || {
  if "${COMPOSE[@]}" exec -T control-api sh -c "test ! -s \"$oracle_kp\"" 2>/dev/null; then
    check "no_oracle_file_kp" 1 "empty/missing file"
  else
    check "no_oracle_file_kp" 0 "nonempty $oracle_kp"
  fi
}
[[ -z "$hot_kp" || "$hot_kp" == "" ]] && check "no_hot_file_kp" 1 "empty path" || {
  if "${COMPOSE[@]}" exec -T control-api sh -c "test ! -s \"$hot_kp\"" 2>/dev/null; then
    check "no_hot_file_kp" 1 "empty/missing file"
  else
    check "no_hot_file_kp" 0 "nonempty $hot_kp"
  fi
}

# Boot log: payout != oracle warning absent / Multi-Sig ok
logs=$("${COMPOSE[@]}" logs --since=2h control-api 2>/dev/null | grep -E 'treasury hot matches oracle|BC-08|Multi-Sig Oracle|GCP KMS' | tail -30 || true)
echo "=== recent custody logs ==="
echo "$logs"

health=$(curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || echo 000)
[[ "$health" == "200" ]] && check "api_health" 1 || check "api_health" 0 "code=$health"

echo "=== inventory ==="
echo "vault=$vault"
echo "hot=$hot"
echo "oracle=$oracle_pub"
echo "cold=$cold"
echo "legacy_treasury=$legacy"
echo "pass=$pass fail=$fail"
if [[ "$fail" -eq 0 ]]; then
  echo "BC08_VERDICT=PASS"
  exit 0
fi
echo "BC08_VERDICT=FAIL"
exit 1
