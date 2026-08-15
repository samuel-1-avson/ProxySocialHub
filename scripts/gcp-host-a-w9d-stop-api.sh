#!/usr/bin/env bash
# Host-A P0.5 / W9.D — stop control-api, reconstruct pinned copies, start again.
# Uses docker start (not compose recreate) so W6 + W10.A observe env stays.
# Never --remove-orphans. Never slash gates. Not a shop-without-ProxyHubb claim.
#
#   CONFIRM_W9D_STOP_API=1 CONTROL_API_URL=http://127.0.0.1:18080 \
#     bash /opt/proxyhubb/scripts/gcp-host-a-w9d-stop-api.sh
set -euo pipefail
if [[ "${CONFIRM_W9D_STOP_API:-}" != "1" ]]; then
  echo "REFUSE: set CONFIRM_W9D_STOP_API=1 on Host-A"
  exit 2
fi
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"
BIN="${W9D_BIN:-/tmp/w9d-bin}"
FIX="${W9D_FIXTURES:-/tmp/w9d-fixtures}"
PINNED="${PROXYHUB_OPERATOR_BUNDLE_PATH:-$ROOT/ops/operators-bundle.json}"
CTR=proxyhubb-control-api-1

need() { [[ -x "$1" ]] || { echo "FAIL: missing $1"; exit 2; }; }
need "$BIN/w9b-listing-bundle"
need "$BIN/w9c-settlement-bundle"
need "$BIN/w7b-manifest-bundle"
[[ -f "$PINNED" ]] || { echo "FAIL: missing pinned bundle $PINNED"; exit 2; }
[[ -f "$FIX/listing-commitments.json" ]] || { echo "FAIL: missing listing fixture"; exit 2; }
[[ -f "$FIX/settlement-receipt.json" ]] || { echo "FAIL: missing settlement fixture"; exit 2; }

restore() {
  sudo docker start "$CTR" >/dev/null 2>&1 || true
}
trap restore EXIT

echo "=== W9.D Host-A API-down reconstruct ==="
curl -fsS --max-time 5 "$API/health" >/dev/null
echo "api_up=1"

sudo docker stop "$CTR" >/dev/null
sleep 2
if curl -fsS --max-time 2 "$API/v1/system/config/public" >/dev/null 2>&1; then
  echo "FAIL: control-api still reachable after stop"
  exit 2
fi
echo "api_down=1"

# W10.D pin is unsigned same_org operators. list reconstructs it; verify would
# fail unsigned and is not required for this soak.
pinned_list="$("$BIN/w7b-manifest-bundle" list "$PINNED")"
printf '%s\n' "$pinned_list"
echo "$pinned_list" | grep -qE 'count=[1-9]'
echo "pinned_bundle_listed=1 unsigned_same_org=1"
"$BIN/w9b-listing-bundle" list "$FIX/listing-commitments.json"
"$BIN/w9b-listing-bundle" verify "$FIX/listing-commitments.json"
"$BIN/w9c-settlement-bundle" verify "$FIX/settlement-receipt.json"

restore
trap - EXIT
for i in $(seq 1 40); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CTR" 2>/dev/null || echo missing)
  [[ "$st" == "healthy" ]] && break
  sleep 3
done
curl -fsS --max-time 5 "$API/health" >/dev/null
cap=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY || true)
gop_a=$(sudo docker exec "$CTR" printenv GATEWAY_OP_A_HOST_ID || true)
echo "session_capability=${cap}"
echo "gateway_op_a=${gop_a}"
[[ "$cap" == "observe" ]] || { echo "FAIL: expected PROXYHUB_SESSION_CAPABILITY=observe"; exit 2; }
echo "W9D_API_DOWN_RECONSTRUCT_OK"
echo "not a storefront; checkout still needs API; programs/session undeployed"
