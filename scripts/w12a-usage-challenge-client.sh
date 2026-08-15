#!/usr/bin/env bash
# Wave 12.A slice 1 — usage-challenge client proof (no on-chain accuse).
# Prefer release. Never resolve_slash. Never arm slash gates. Not DePIN.
#
#   ./scripts/w12a-usage-challenge-client.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/services/control-api"
WORKDIR="${W12A_WORKDIR:-$(mktemp -d)}"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

echo "=== W12.A usage-challenge client (no accuse) ==="
(cd "$API_DIR" && go test ./internal/settlement -count=1 -run UsageChallenge)

echo "--- demo petition ---"
(cd "$API_DIR" && go run ./cmd/w12a-usage-challenge demo) > "$WORKDIR/petition.json"

echo "--- verify ---"
(cd "$API_DIR" && go run ./cmd/w12a-usage-challenge verify "$WORKDIR/petition.json")

echo "--- hash ---"
(cd "$API_DIR" && go run ./cmd/w12a-usage-challenge hash "$WORKDIR/petition.json")

if [[ "${CONFIRM_W12A_ACCUSE:-}" == "1" || "${CONFIRM_W12A_RELEASE_SOAK:-}" == "1" ]]; then
  echo "FAIL: this client script is not the live accuse soak"
  exit 2
fi

echo "W12A_USAGE_CHALLENGE_CLIENT_OK"
echo "not on-chain; not slash; not DePIN; programs/session undeployed"
