#!/usr/bin/env bash
# Wave 10.B — browse honesty when PROXYHUB_LISTING_COMMITMENT=observe.
#
# Default: unit + CLI honesty (no GCP, no SOL).
# Live Host-A soak:
#   1. Honesty-only control-api rebuild if discovery still hardcodes hash-only
#   2. Recreate with observe, assert public config + GET /v1/listings
#   3. Restore env off (keep new binary)
#
#   CONFIRM_W10B_OBSERVE=1 bash scripts/gcp-smoke-sprint-w10b-browse-honesty.sh
#   Optional patch: /tmp/w10b-listings_discovery.go
#
# This Host-A roll does not copy listing_commitment_sync (no register on publish).
# Not enforce. Not a catalog. Not DePIN. programs/session stays undeployed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/services/control-api"
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
SESSION_ID="8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb"
PROGRAM_ID="${SOLANA_PROGRAM_ID:-AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu}"
WANT="ed25519_offer_hash+listing_commitment_pda"
OFF_WANT="ed25519_offer_hash"
DISC_GO="$PROJECT_DIR/services/control-api/internal/api/listings_discovery.go"
PATCH_SRC="${W10B_PATCH:-/tmp/w10b-listings_discovery.go}"

echo "=== W10.B browse honesty (observe) ==="
if [[ "$PROGRAM_ID" == "$SESSION_ID" ]]; then
  echo "REFUSE: programs/session"
  exit 2
fi

if [[ -f "$API_DIR/go.mod" ]]; then
  echo "--- go unit ---"
  (cd "$API_DIR" && go test ./internal/api/ ./internal/decentralization/ -count=1 \
    -run 'DiscoveryHonesty|GetListings_DiscoveryHonestyObserve|GetPublicSystemConfig_ListingCommitmentObserveHonesty|ListingCommitmentMode')
  echo "W10B_GO_OK"

  echo "--- CLI honesty observe ---"
  HONESTY=$(cd "$API_DIR" && PROXYHUB_LISTING_COMMITMENT=observe go run ./cmd/w9a-listing-commitment honesty)
  echo "$HONESTY"
  echo "$HONESTY" | grep -q "$WANT" || { echo "FAIL: CLI honesty missing $WANT"; exit 2; }
  echo "W10B_CLI_OBSERVE_OK"
else
  echo "skip local go (no $API_DIR/go.mod)"
fi

if [[ "${CONFIRM_W10B_OBSERVE:-}" != "1" ]]; then
  echo "skip live GCP soak (set CONFIRM_W10B_OBSERVE=1 on Host-A)"
  echo "gcp default stays off; not a catalog; delist stays platform"
  echo "W10B_BROWSE_HONESTY_LOCAL_OK"
  exit 0
fi

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "FAIL: CONFIRM_W10B_OBSERVE=1 must run on Host-A ($PROJECT_DIR missing)"
  exit 2
fi

DOCKER="${DOCKER:-docker}"
COMPOSE=("$DOCKER" compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml)
OVERRIDE="/tmp/w10b-observe.yml"
cat > "$OVERRIDE" <<'YAML'
services:
  control-api:
    environment:
      - PROXYHUB_LISTING_COMMITMENT=observe
YAML

restored=0
wait_api() {
  local i st
  for i in $(seq 1 60); do
    st=$("$DOCKER" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' proxyhubb-control-api-1 2>/dev/null || true)
    if [[ "$st" == "healthy" ]] && curl -fsS "$API/v1/system/config/public" >/dev/null 2>&1; then
      return 0
    fi
    echo "wait_api try=$i status=${st:-down}"
    sleep 5
  done
  echo "FAIL: control-api did not become healthy at $API"
  return 1
}

read_honesty() {
  python3 -c 'import json,sys
d=json.load(sys.stdin)
disc=d.get("discovery") or {}
print("mode="+str(disc.get("listing_commitment_mode") or "")
      +" commitments="+str(disc.get("listing_commitments") or "")
      +" catalog="+str(disc.get("catalog_source") or "")
      +" delist="+str(disc.get("delist_authority") or ""))'
}

in_container_honesty() {
  "$DOCKER" exec proxyhubb-control-api-1 wget -qO- http://127.0.0.1:8080/v1/system/config/public | read_honesty
}

assert_observe() {
  local label="$1" raw="$2"
  echo "$label $raw"
  echo "$raw" | grep -q 'mode=observe' || { echo "FAIL: $label mode not observe"; return 1; }
  echo "$raw" | grep -q "commitments=$WANT" || { echo "FAIL: $label commitments not $WANT"; return 1; }
  echo "$raw" | grep -q 'catalog=postgres' || { echo "FAIL: $label catalog_source must stay postgres"; return 1; }
  echo "$raw" | grep -q 'delist=platform_moderation' || { echo "FAIL: $label delist must stay platform"; return 1; }
}

restore_off() {
  if [[ "$restored" == "1" ]]; then
    return 0
  fi
  restored=1
  echo "=== restore PROXYHUB_LISTING_COMMITMENT=off ==="
  cd "$PROJECT_DIR"
  "${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
  wait_api || true
}

echo "=== honesty source on Host-A ==="
if ! grep -q 'ListingCommitmentMode' "$DISC_GO"; then
  if [[ ! -f "$PATCH_SRC" ]]; then
    echo "FAIL: Host-A discovery hardcodes hash-only; provide $PATCH_SRC"
    exit 2
  fi
  echo "patching $DISC_GO from $PATCH_SRC"
  cp -a "$DISC_GO" "/tmp/listings_discovery.go.w10b.bak"
  tr -d '\015' < "$PATCH_SRC" > "$DISC_GO"
  grep -q 'ListingCommitmentMode' "$DISC_GO"
  echo "tag pre-image"
  "$DOCKER" tag proxyhubb-control-api:latest proxyhubb-control-api:w10b-pre 2>/dev/null || \
    "$DOCKER" tag proxyhubb-control-api proxyhubb-control-api:w10b-pre
  echo "=== build control-api (honesty only; no listing_commitment_sync) ==="
  cd "$PROJECT_DIR"
  "${COMPOSE[@]}" build control-api
  echo "W10B_CONTROL_API_BUILT"
else
  echo "source already has ListingCommitmentMode"
fi

trap restore_off EXIT

echo "=== live observe soak (read-only honesty; do not publish listings) ==="
cd "$PROJECT_DIR"
BASELINE=$(curl -fsS "$API/v1/system/config/public" | read_honesty || true)
echo "baseline $BASELINE"

"${COMPOSE[@]}" -f "$OVERRIDE" up -d --no-deps --force-recreate control-api
wait_api

MODE_ENV=$("$DOCKER" exec proxyhubb-control-api-1 printenv PROXYHUB_LISTING_COMMITMENT 2>/dev/null | tr -d '\r' || true)
echo "container PROXYHUB_LISTING_COMMITMENT=${MODE_ENV:-unset}"
[[ "$MODE_ENV" == "observe" ]] || { echo "FAIL: container mode ${MODE_ENV:-unset}"; exit 2; }

INNER=$(in_container_honesty)
PUB=$(curl -fsS "$API/v1/system/config/public" | read_honesty)
LST=$(curl -fsS "$API/v1/listings?limit=1" | read_honesty)
assert_observe "in_container" "$INNER"
assert_observe "public_config" "$PUB"
assert_observe "listings" "$LST"
echo "W10B_BROWSE_HONESTY_OBSERVE_OK"

restore_off
trap - EXIT

OFF_INNER=$(in_container_honesty)
OFF_PUB=$(curl -fsS "$API/v1/system/config/public" | read_honesty)
echo "restored_inner $OFF_INNER"
echo "restored_public $OFF_PUB"
echo "$OFF_INNER" | grep -q 'mode=off' || { echo "FAIL: restored mode not off"; exit 2; }
echo "$OFF_INNER" | grep -q "commitments=$OFF_WANT" || { echo "FAIL: restore did not return hash-only honesty"; exit 2; }
OFF_ENV=$("$DOCKER" exec proxyhubb-control-api-1 printenv PROXYHUB_LISTING_COMMITMENT 2>/dev/null | tr -d '\r' || true)
if [[ -n "${OFF_ENV:-}" && "$OFF_ENV" != "off" ]]; then
  echo "FAIL: container still PROXYHUB_LISTING_COMMITMENT=$OFF_ENV"
  exit 2
fi
echo "W10B_RESTORED_OFF"
echo "not a catalog; delist stays platform; programs/session stays undeployed; gcp default off"
echo "Host-A does not deploy listing_commitment_sync in this slice"
