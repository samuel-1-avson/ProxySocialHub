#!/usr/bin/env bash
# Wave 9.A soak cluster — ListingCommitment PDA via SBF proxyhub.so.
# Native processor is not used (Anchor 0.32 solana-invoke needs target_os=solana).
# Does not upgrade live proxyhub. Does not deploy programs/session.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SO="${SBF_OUT_DIR:-$ROOT/services/solana-programs/proxyhub/target/deploy}/proxyhub.so"
echo "=== W9.A listing-commitment soak cluster ==="
test -f "$SO"
grep -aq "Listing commitment registered" "$SO" || {
  echo "FAIL: $SO lacks ListingCommitment. Rebuild current proxyhub source (keep onchain-groth16 for live upgrade)."
  exit 2
}
cargo test --manifest-path "$ROOT/services/solana-programs/proxyhub/programs/proxyhub/Cargo.toml" --test w9a_soak -- --nocapture
echo "W9A_LISTING_COMMITMENT_SOAK_OK"
echo "live ELF upgrade remains a separate gated step; gcp default stays off"
