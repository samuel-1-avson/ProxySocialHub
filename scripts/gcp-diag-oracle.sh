#!/bin/bash
# Diagnose oracle settle prerequisites on proxyhubb-testnet (no secret values printed).
set -euo pipefail
cd /opt/proxyhubb

echo "=== .env presence (redacted) ==="
for k in ORACLE_PRIVATE_KEY SOLANA_ORACLE_KEYPAIR SOLANA_PROGRAM_ID SOLANA_RPC_ENDPOINT SOLANA_NETWORK SOLANA_TREASURY_ADDRESS; do
  if grep -qE "^${k}=" .env 2>/dev/null; then
    val=$(grep -E "^${k}=" .env | head -1 | cut -d= -f2-)
    if [ -z "$val" ]; then
      echo "${k}=EMPTY"
    else
      echo "${k}=SET len=${#val} prefix=${val:0:8}…"
    fi
  else
    echo "${k}=MISSING"
  fi
done

echo "=== keypair files on host ==="
ls -la infra/oracle-keypair.json oracle-keypair.json 2>&1 | head -5 || true

COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== inside control-api container ==="
"${COMPOSE[@]}" exec -T control-api sh -c '
  if [ -f /run/secrets/oracle-keypair.json ]; then
    echo "oracle-keypair.json=PRESENT bytes=$(wc -c </run/secrets/oracle-keypair.json)"
  else
    echo "oracle-keypair.json=MISSING"
  fi
  echo "SOLANA_ORACLE_KEYPAIR=${SOLANA_ORACLE_KEYPAIR:-unset}"
  if [ -n "${ORACLE_PRIVATE_KEY:-}" ]; then echo "ORACLE_PRIVATE_KEY=SET"; else echo "ORACLE_PRIVATE_KEY=UNSET"; fi
  echo "SOLANA_PROGRAM_ID=${SOLANA_PROGRAM_ID:-unset}"
  echo "SOLANA_RPC_ENDPOINT=${SOLANA_RPC_ENDPOINT:-unset}"
  echo "SOLANA_NETWORK=${SOLANA_NETWORK:-unset}"
'

echo "=== recent oracle/settle logs ==="
"${COMPOSE[@]}" logs --tail=80 control-api 2>/dev/null | grep -iE 'oracle|settle|program|keypair' | tail -20 || true
echo DONE
