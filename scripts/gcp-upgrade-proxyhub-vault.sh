#!/usr/bin/env bash
# Upgrade proxyhub program on devnet and initialize deposit vault.
# Prereqs: proxyhub.so present, oracle keypair is upgrade authority + program admin.
set -euo pipefail

PROGRAM_ID="${SOLANA_PROGRAM_ID:-AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu}"
SO_PATH="${SO_PATH:-/tmp/proxyhub.so}"
ORACLE_KP="${ORACLE_KP:-/opt/proxyhubb/infra/oracle-keypair.json}"
HOT="${HOT:-FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3}"
RPC="${RPC:-https://api.devnet.solana.com}"
VAULT_PDA="${VAULT_PDA:-8LZji2G9nn7ywoLwopgcREpm5xQHpvRJY1az1R9hHRzm}"

echo "== preflight =="
test -f "$SO_PATH"
test -f "$ORACLE_KP"
docker run --rm -v "$ORACLE_KP:/k.json:ro" --entrypoint solana-keygen solanalabs/solana:v1.18.26 pubkey /k.json
ls -la "$SO_PATH"
sha256sum "$SO_PATH"

echo "== upgrade =="
docker run --rm \
  -v "$ORACLE_KP:/k.json:ro" \
  -v "$SO_PATH:/proxyhub.so:ro" \
  --entrypoint solana \
  solanalabs/solana:v1.18.26 \
  program deploy \
  --url "$RPC" \
  --keypair /k.json \
  --program-id "$PROGRAM_ID" \
  --upgrade-authority /k.json \
  /proxyhub.so

echo "== verify =="
docker run --rm --entrypoint solana solanalabs/solana:v1.18.26 program show "$PROGRAM_ID" --url "$RPC"

echo "== set env for vault (credit still off until init ix succeeds) =="
cd /opt/proxyhubb
if grep -q '^SOLANA_DEPOSIT_VAULT_ADDRESS=' .env; then
  sed -i "s|^SOLANA_DEPOSIT_VAULT_ADDRESS=.*|SOLANA_DEPOSIT_VAULT_ADDRESS=$VAULT_PDA|" .env
else
  echo "SOLANA_DEPOSIT_VAULT_ADDRESS=$VAULT_PDA" >> .env
fi
grep '^SOLANA_DEPOSIT_VAULT_ADDRESS=' .env

echo "UPGRADE_DONE"
echo "Next: initialize_deposit_vault via Anchor/IDL once IDL is regenerated, then enable CREDIT flag."
