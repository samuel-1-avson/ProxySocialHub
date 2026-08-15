#!/usr/bin/env bash
# Finish deposit vault cutover on GCP testnet:
#   1) Ensure vault credit on
#   2) Flip UI on (advertise vault PDA)
#   3) Freeze legacy EOA credit
#   4) Optionally sweep leftover SOL from legacy treasury EOA → vault (ops, not a user deposit)
#
# Usage (on VM as root under /opt/proxyhubb):
#   KEEP_FLAG=1 SWEEP=1 bash scripts/gcp-cutover-deposit-vault.sh
set -euo pipefail
cd "${PROJECT_DIR:-/opt/proxyhubb}"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
RPC="${RPC:-}"
if [[ -z "$RPC" ]]; then
  RPC=$(grep -E '^SOLANA_RPC_ENDPOINT=' .env | head -1 | cut -d= -f2- | tr -d '\r' || true)
fi
RPC="${RPC:-https://api.devnet.solana.com}"

set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

echo "=== FLAGS: vault credit on, UI on, legacy credit off ==="
set_env PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED true
set_env PROXYHUB_DEPOSIT_VAULT_UI true
set_env PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT false

VAULT=$(grep -E '^SOLANA_DEPOSIT_VAULT_ADDRESS=' .env | head -1 | cut -d= -f2- | tr -d '\r')
TREASURY=$(grep -E '^SOLANA_TREASURY_ADDRESS=' .env | head -1 | cut -d= -f2- | tr -d '\r')
HOT=$(grep -E '^SOLANA_TREASURY_HOT_ADDRESS=' .env | head -1 | cut -d= -f2- | tr -d '\r')
[[ -n "$VAULT" ]] || { echo "SOLANA_DEPOSIT_VAULT_ADDRESS missing"; exit 1; }
[[ -n "$TREASURY" ]] || { echo "SOLANA_TREASURY_ADDRESS missing"; exit 1; }

"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 40); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "$st" | grep -qi healthy && break
  sleep 3
done
echo "$st" | grep -qi healthy

echo "=== public config ==="
curl -fsS http://127.0.0.1:18080/v1/system/config/public | head -c 800 || \
  curl -fsS http://127.0.0.1:8080/v1/system/config/public | head -c 800 || true
echo

UI=$("${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_DEPOSIT_VAULT_UI | tr -d '\r')
LEG=$("${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT | tr -d '\r')
CR=$("${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED | tr -d '\r')
echo "flags ui=$UI legacy=$LEG credit=$CR"
[[ "$UI" == "true" && "$LEG" == "false" && "$CR" == "true" ]] || { echo "flag mismatch"; exit 1; }

if [[ "${SWEEP:-0}" == "1" ]]; then
  if [[ "$TREASURY" == "$HOT" ]]; then
    echo "SKIP_SWEEP: SOLANA_TREASURY_ADDRESS == hot wallet — do not drain payout float into vault"
  else
    echo "=== sweep leftover EOA → vault (manual keypair required) ==="
    LEGACY_KP="${LEGACY_TREASURY_KP:-/opt/proxyhubb/secrets/legacy-treasury-keypair.json}"
    if [[ ! -f "$LEGACY_KP" ]]; then
      echo "No $LEGACY_KP — leave residual SOL on EOA or place keypair and re-run with SWEEP=1"
    else
      sol() {
        docker run --rm --network host --entrypoint solana \
          -v /opt/proxyhubb:/opt/proxyhubb -v /tmp:/tmp \
          solanalabs/solana:v1.18.26 "$@"
      }
      bal=$(sol balance "$TREASURY" --url "$RPC" | awk '{print $1}')
      # leave dust for rent-exempt account if needed
      xfer=$(python3 - <<PY
b=float("$bal"); keep=0.002
print(f"{max(0.0, b-keep):.9f}")
PY
)
      echo "treasury_eoa_bal=$bal sweep=$xfer → vault=$VAULT"
      if python3 -c "import sys; sys.exit(0 if float(sys.argv[1])>0.001 else 1)" "$xfer"; then
        sol transfer --from "$LEGACY_KP" --keypair "$LEGACY_KP" "$VAULT" "$xfer" \
          --url "$RPC" --allow-unfunded-recipient --fee-payer "$LEGACY_KP"
        echo SWEEP_OK
      else
        echo "nothing meaningful to sweep"
      fi
    fi
  fi
fi

echo DEPOSIT_CUTOVER_DONE
