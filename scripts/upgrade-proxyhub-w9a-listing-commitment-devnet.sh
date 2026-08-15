#!/usr/bin/env bash
# Wave 9.A — upgrade live proxyhub with ListingCommitment (devnet only).
# Never programs/session. Never mainnet. Preserves Groth16 bytecode.
#
# The existing BC-06 .so does NOT include ListingCommitment. Rebuild first:
#   cd services/solana-programs/proxyhub
#   .\build-anchor-docker.ps1 -AnchorCommand "anchor build -p proxyhub --no-idl -- --features onchain-groth16"
#
# Usage (laptop, cold upgrade authority — not the app VM):
#   CONFIRM_W9A_UPGRADE=1 \
#   SO_PATH=services/solana-programs/proxyhub/target/deploy/proxyhub.so \
#   UPGRADE_KP=infra/secrets/upgrade-authority-keypair.json \
#   bash scripts/upgrade-proxyhub-w9a-listing-commitment-devnet.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROGRAM_ID="${SOLANA_PROGRAM_ID:-AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu}"
SESSION_ID="8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb"
SO_PATH="${SO_PATH:-$ROOT/services/solana-programs/proxyhub/target/deploy/proxyhub.so}"
UPGRADE_KP="${UPGRADE_KP:-$ROOT/infra/secrets/upgrade-authority-keypair.json}"
EXPECTED_AUTH="${EXPECTED_UPGRADE_AUTHORITY:-6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR}"
RPC="${RPC:-https://api.devnet.solana.com}"
PAYER_KP="${PAYER_KP:-$UPGRADE_KP}"
CLUSTER="${SOLANA_CLUSTER:-devnet}"

echo "=== W9.A proxyhub ListingCommitment upgrade (devnet) ==="

if [[ "$PROGRAM_ID" == "$SESSION_ID" ]]; then
  echo "REFUSE: SOLANA_PROGRAM_ID must not be programs/session"
  exit 2
fi

case "$CLUSTER" in
  mainnet|mainnet-beta)
    echo "REFUSE: never upgrade proxyhub to mainnet from this script"
    exit 2
    ;;
esac

if [[ "${CONFIRM_W9A_UPGRADE:-}" != "1" ]]; then
  echo "REFUSE: set CONFIRM_W9A_UPGRADE=1 after the .so contains ListingCommitment AND Groth16."
  echo "This script does not run the upgrade without that confirm."
  exit 2
fi

test -f "$SO_PATH"
test -f "$UPGRADE_KP"
if ! grep -aq "Listing commitment registered" "$SO_PATH"; then
  echo "FAIL: $SO_PATH lacks ListingCommitment marker. Rebuild with current proxyhub source + onchain-groth16." >&2
  exit 1
fi
if ! grep -aq "Groth16" "$SO_PATH"; then
  echo "FAIL: $SO_PATH lacks Groth16. Live cluster is groth16-ready; do not strip the verifier." >&2
  exit 1
fi

AUTH_PUB=$(solana-keygen pubkey "$UPGRADE_KP")
echo "upgrade_authority_pubkey=$AUTH_PUB"
[[ "$AUTH_PUB" == "$EXPECTED_AUTH" ]] || {
  echo "FAIL: upgrade key pubkey $AUTH_PUB != expected $EXPECTED_AUTH" >&2
  exit 1
}

echo "so_sha256=$(sha256sum "$SO_PATH" | awk '{print $1}')"
solana program show "$PROGRAM_ID" --url "$RPC"

solana program deploy \
  --url "$RPC" \
  --keypair "$PAYER_KP" \
  --program-id "$PROGRAM_ID" \
  --upgrade-authority "$UPGRADE_KP" \
  "$SO_PATH"

solana program show "$PROGRAM_ID" --url "$RPC"
echo "W9A_PROXYHUB_UPGRADE_DONE"
echo "gcp PROXYHUB_LISTING_COMMITMENT stays off until an observe soak; not a catalog"
