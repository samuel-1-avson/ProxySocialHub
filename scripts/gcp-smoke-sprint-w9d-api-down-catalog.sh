#!/usr/bin/env bash
# Wave 9.D — reconstruct listing-commitment (and optional settlement) bundle
# without control-api. Not "shop without ProxyHubb".
#
# Default: emit a signed fixture, prove CONTROL_API_URL is unreachable, verify.
# Optional live container stop (host-A docker, not this laptop):
#   CONFIRM_W9D_STOP_API=1 ./scripts/gcp-smoke-sprint-w9d-api-down-catalog.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/services/control-api"
API="${CONTROL_API_URL:-http://127.0.0.1:1}"
WORKDIR="${W9D_WORKDIR:-$(mktemp -d)}"
BUNDLE="$WORKDIR/listing-commitments.json"
RECEIPT="$WORKDIR/settlement-receipt.json"

echo "=== W9.D API-down catalog reconstruct ==="
echo "api=$API workdir=$WORKDIR"

echo "--- unit ---"
(cd "$API_DIR" && go test ./internal/catalog/ ./internal/settlement/ -count=1 -run 'EmitSample|VerifyBundle|ParseBundle|WouldBroadcast')

echo "--- emit fixtures (no Postgres) ---"
(cd "$API_DIR" && go run ./cmd/w9b-listing-bundle emit) > "$BUNDLE"
(cd "$API_DIR" && go run ./cmd/w9c-settlement-bundle emit) > "$RECEIPT"

echo "--- prove API unreachable ---"
if curl -fsS --max-time 2 "$API/v1/system/config/public" >/dev/null 2>&1 || \
   curl -fsS --max-time 2 "$API/v1/listings" >/dev/null 2>&1; then
  if [[ "${CONFIRM_W9D_STOP_API:-}" == "1" ]]; then
    echo "--- soak: stop control-api ---"
    sudo docker stop proxyhubb-control-api-1 >/dev/null
    sleep 2
    if curl -fsS --max-time 2 "$API/v1/system/config/public" >/dev/null 2>&1; then
      sudo docker start proxyhubb-control-api-1 >/dev/null || true
      echo "FAIL: control-api still reachable after stop"
      exit 2
    fi
    echo "api_down=1"
  else
    echo "FAIL: $API is reachable. Point CONTROL_API_URL at a down endpoint, or set CONFIRM_W9D_STOP_API=1 on the host."
    exit 2
  fi
else
  echo "api_down=1"
fi

echo "--- reconstruct listing bundle ---"
(cd "$API_DIR" && go run ./cmd/w9b-listing-bundle list "$BUNDLE")
(cd "$API_DIR" && go run ./cmd/w9b-listing-bundle verify "$BUNDLE")

echo "--- reconstruct settlement receipt ---"
(cd "$API_DIR" && go run ./cmd/w9c-settlement-bundle verify "$RECEIPT")

PINNED="${PROXYHUB_OPERATOR_BUNDLE_PATH:-}"
if [[ -z "$PINNED" && -f /opt/proxyhubb/ops/operators-bundle.json ]]; then
  PINNED=/opt/proxyhubb/ops/operators-bundle.json
fi
if [[ -n "$PINNED" && -f "$PINNED" ]]; then
  echo "--- reconstruct pinned operator bundle ---"
  (cd "$API_DIR" && go run ./cmd/w7b-manifest-bundle list "$PINNED")
  (cd "$API_DIR" && go run ./cmd/w7b-manifest-bundle verify "$PINNED")
fi

if [[ "${CONFIRM_W9D_STOP_API:-}" == "1" ]]; then
  sudo docker start proxyhubb-control-api-1 >/dev/null || true
fi

echo "W9D_API_DOWN_RECONSTRUCT_OK"
echo "not a storefront; checkout/new orders may still need the API; programs/session undeployed"
