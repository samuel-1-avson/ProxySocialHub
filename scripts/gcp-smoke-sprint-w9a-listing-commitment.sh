#!/usr/bin/env bash
# Wave 9.A — ListingCommitment PDA (not a catalog; not programs/session).
#
# Live register is a separate soak:
#   CONFIRM_W9A_LIVE=1  — send register_listing_commitment (oracle key required)
#   CONFIRM_W9A_DEPLOY=1 — this script still refuses to upgrade proxyhub.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"
API_DIR="$ROOT/services/control-api"
PROGRAM_ID="${SOLANA_PROGRAM_ID:-AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu}"
SESSION_ID="8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb"

echo "=== W9.A listing commitment (no session deploy) ==="

if [[ "$PROGRAM_ID" == "$SESSION_ID" ]]; then
  echo "REFUSE: SOLANA_PROGRAM_ID must not be programs/session"
  exit 2
fi

if [[ "${CONFIRM_W9A_DEPLOY:-}" == "1" ]]; then
  echo "REFUSE: CONFIRM_W9A_DEPLOY=1 is not an upgrade tool. Use the dedicated proxyhub upgrade script with cold upgrade authority. Never deploy programs/session."
  exit 2
fi

echo "--- go unit ---"
(cd "$API_DIR" && go test ./internal/solana/ ./internal/decentralization/ ./internal/api/ -count=1 -run 'ListingCommitment|DiscoveryHonesty|ClassifyListingCommitment')
echo "W9A_GO_OK"

echo "--- CLI honesty / pda ---"
(cd "$API_DIR" && go run ./cmd/w9a-listing-commitment honesty)
SAMPLE_PROVIDER="11111111111111111111111111111111"
SAMPLE_HASH="abababababababababababababababababababababababababababababababab"
(cd "$API_DIR" && go run ./cmd/w9a-listing-commitment pda "$SAMPLE_PROVIDER" "$SAMPLE_HASH")

echo "--- live probe (read-only) ---"
PROBE=$(cd "$API_DIR" && go run ./cmd/w9a-listing-commitment probe) || true
echo "$PROBE"
echo "$PROBE" | grep -q '"ix_status": "ix_present"' && echo "W9A_IX_PRESENT" || echo "W9A_IX_NOT_ON_LIVE"

if [[ "${CONFIRM_W9A_LIVE:-}" == "1" ]]; then
  echo "--- live register (gated) ---"
  : "${W9A_PROVIDER:?set W9A_PROVIDER}"
  : "${W9A_OFFER_HASH:?set W9A_OFFER_HASH}"
  : "${W9A_LISTING_ID:?set W9A_LISTING_ID}"
  (cd "$API_DIR" && CONFIRM_W9A_LIVE=1 go run ./cmd/w9a-listing-commitment register "$W9A_PROVIDER" "$W9A_OFFER_HASH" "$W9A_LISTING_ID")
  echo "W9A_LISTING_COMMITMENT_LIVE_OK"
fi

echo "--- live honesty (optional) ---"
HONESTY=$(curl -fsS "$API/v1/system/config/public" 2>/dev/null | python3 -c 'import json,sys
d=json.load(sys.stdin)
disc=d.get("discovery") or {}
print("mode="+str(disc.get("listing_commitment_mode"))+" commitments="+str(disc.get("listing_commitments"))+" catalog="+str(disc.get("catalog_source")))' || true)
echo "honesty=$HONESTY"

echo "W9A_LISTING_COMMITMENT_OK"
echo "not a catalog; delist stays platform; programs/session stays undeployed; gcp default may remain off"
