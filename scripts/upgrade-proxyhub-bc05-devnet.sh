#!/usr/bin/env bash
# Upgrade proxyhub on Solana devnet with BC-05 bytecode.
# Uses COLD upgrade authority (never oracle). Do not copy the key to the app VM.
#
# Usage (from repo root, laptop):
#   SO_PATH=services/solana-programs/proxyhub/target/deploy/proxyhub.so \
#   UPGRADE_KP=infra/secrets/upgrade-authority-keypair.json \
#   bash scripts/upgrade-proxyhub-bc05-devnet.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROGRAM_ID="${SOLANA_PROGRAM_ID:-AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu}"
SO_PATH="${SO_PATH:-$ROOT/services/solana-programs/proxyhub/target/deploy/proxyhub.so}"
UPGRADE_KP="${UPGRADE_KP:-$ROOT/infra/secrets/upgrade-authority-keypair.json}"
EXPECTED_AUTH="${EXPECTED_UPGRADE_AUTHORITY:-6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR}"
RPC="${RPC:-https://api.devnet.solana.com}"
# Fee payer may differ from cold upgrade authority (authority often unfunded).
PAYER_KP="${PAYER_KP:-$UPGRADE_KP}"

echo "== preflight =="
test -f "$SO_PATH"
test -f "$UPGRADE_KP"
test -f "$PAYER_KP"
AUTH_PUB=$(solana-keygen pubkey "$UPGRADE_KP")
echo "upgrade_authority_pubkey=$AUTH_PUB"
echo "fee_payer_pubkey=$(solana-keygen pubkey "$PAYER_KP")"
[[ "$AUTH_PUB" == "$EXPECTED_AUTH" ]] || {
  echo "FAIL: upgrade key pubkey $AUTH_PUB != expected $EXPECTED_AUTH" >&2
  exit 1
}
echo "so_sha256=$(sha256sum "$SO_PATH" | awk '{print $1}')"
ls -la "$SO_PATH"

echo "== on-chain before =="
solana program show "$PROGRAM_ID" --url "$RPC" || true

echo "== upgrade =="
solana program deploy \
  --url "$RPC" \
  --keypair "$PAYER_KP" \
  --program-id "$PROGRAM_ID" \
  --upgrade-authority "$UPGRADE_KP" \
  "$SO_PATH"

echo "== on-chain after =="
solana program show "$PROGRAM_ID" --url "$RPC"
DUMP=/tmp/proxyhub-bc05-dumped.so
solana program dump "$PROGRAM_ID" "$DUMP" --url "$RPC"
echo "dumped_sha256=$(sha256sum "$DUMP" | awk '{print $1}')"
echo BC05_UPGRADE_DONE
