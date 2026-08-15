#!/usr/bin/env bash
# Wave 9.B — listing-commitment bundle. Not a merchandising catalog.
# Optional live PDA: CONFIRM_W9B_ONCHAIN=1 emit-onchain (read-only RPC; no SOL).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/services/control-api"
SESSION_ID="8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb"
PROGRAM_ID="${SOLANA_PROGRAM_ID:-AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu}"

echo "=== W9.B listing-commitment bundle ==="
if [[ "$PROGRAM_ID" == "$SESSION_ID" ]]; then
  echo "REFUSE: programs/session"
  exit 2
fi
(cd "$API_DIR" && go test ./internal/catalog/ ./internal/api/ ./internal/solana/ -count=1 -run 'SourceDefault|BuildAndVerifyListingBundle|ParseBundle|DiscoveryHonesty|SoakListing|FetchListingCommitmentRejectsSession')
echo "W9B_BUNDLE_VERIFY_OK"

if [[ "${CONFIRM_W9B_ONCHAIN:-}" == "1" ]]; then
  echo "=== emit-onchain (RPC confirm soak PDA) ==="
  BUNDLE="${TMPDIR:-/tmp}/w9b-onchain-bundle.json"
  (cd "$API_DIR" && go run ./cmd/w9b-listing-bundle emit-onchain) > "$BUNDLE"
  (cd "$API_DIR" && go run ./cmd/w9b-listing-bundle list "$BUNDLE")
  (cd "$API_DIR" && go run ./cmd/w9b-listing-bundle verify "$BUNDLE")
  grep -q '"on_chain": true' "$BUNDLE"
  echo "W9B_ON_CHAIN_TRUE"
fi

echo "catalog_source remains postgres unless a bundle is pinned; not DePIN"

