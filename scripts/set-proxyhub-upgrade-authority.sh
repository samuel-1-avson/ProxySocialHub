#!/usr/bin/env bash
# Move proxyhub program upgrade authority off the hot oracle wallet.
#
# Prereqs:
#   - CURRENT_AUTHORITY keypair can sign (today: oracle)
#   - NEW_AUTHORITY is a pubkey (offline / hardware / multisig) OR a keypair path
#
# Example:
#   CURRENT_KP=./infra/oracle-keypair.json \
#   NEW_AUTHORITY=YourOfflinePubkey111... \
#   bash scripts/set-proxyhub-upgrade-authority.sh
set -euo pipefail
PROGRAM_ID="${PROGRAM_ID:-AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu}"
RPC="${RPC:-https://api.devnet.solana.com}"
CURRENT_KP="${CURRENT_KP:?set CURRENT_KP to current upgrade-authority keypair}"
NEW_AUTHORITY="${NEW_AUTHORITY:?set NEW_AUTHORITY to new pubkey or keypair path}"

solana program show "$PROGRAM_ID" --url "$RPC"

echo "Setting upgrade authority → $NEW_AUTHORITY"
if [[ -f "$NEW_AUTHORITY" ]]; then
  solana program set-upgrade-authority "$PROGRAM_ID" \
    --url "$RPC" \
    --keypair "$CURRENT_KP" \
    --new-upgrade-authority "$NEW_AUTHORITY"
else
  # Pubkey-only: new authority need not co-sign the transfer.
  solana program set-upgrade-authority "$PROGRAM_ID" \
    --url "$RPC" \
    --keypair "$CURRENT_KP" \
    --new-upgrade-authority "$NEW_AUTHORITY" \
    --skip-new-upgrade-authority-signer-check
fi

solana program show "$PROGRAM_ID" --url "$RPC"
echo UPGRADE_AUTHORITY_MOVED
