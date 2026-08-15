#!/usr/bin/env bash
# Wave 7.D — third-party operator join path (org boundary).
#
# Default: keygen + sign with a non-platform org_id + bundle verify (no VPS).
# Optional live volunteer host:
#   CONFIRM_W7D_EXTERNAL_VPS=1 ./scripts/gcp-smoke-sprint-w7d-third-party-operator.sh
set -euo pipefail
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/services/control-api"
WORKDIR="${TMPDIR:-/tmp}/w7d-operator-$$"
mkdir -p "$WORKDIR"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

echo "=== W7.D third-party operator ==="

HONESTY=$(curl -fsS "$API/v1/system/config/public" 2>/dev/null | python3 -c 'import json,sys
d=json.load(sys.stdin)
g=d.get("gateway_operators") or {}
print("org="+str(g.get("operator_org_diversity"))+" host="+str(g.get("operator_host_diversity"))+" platform="+str(g.get("platform_org_id"))+" rotate="+str(g.get("foreign_operator_key_rotation")))' || true)
echo "honesty=$HONESTY"

echo "--- keygen (seed stays local) ---"
(cd "$API_DIR" && go run ./cmd/w7d-operator-join keygen) > "$WORKDIR/key.json"
python3 - "$WORKDIR/key.json" <<'PY'
import json,sys
k=json.load(open(sys.argv[1]))
assert k.get("signing_key") and k.get("pubkey"), k
print("pubkey="+k["pubkey"][:16]+"…")
PY

echo "--- sign distinct org_id ---"
python3 - "$WORKDIR/key.json" <<'PY' | (cd "$API_DIR" && go run ./cmd/w7d-operator-join sign) > "$WORKDIR/join.json"
import json,sys
key=json.load(open(sys.argv[1]))
print(json.dumps({
  "signing_key": key["signing_key"],
  "slug": "edge-ext",
  "org_id": "ext-operator-org-1",
  "host_id": "vps-ext-1",
  "buyer_base_url": "http://203.0.113.50:8090",
  "health_url": "http://203.0.113.50:8090/health",
  "tunnel_addrs": ["203.0.113.50:3128"],
  "peer_urls": ["edge-a@http://10.0.0.1:8090"],
  "bonded": True,
}))
PY
python3 - "$WORKDIR/join.json" <<'PY'
import json,sys
j=json.load(open(sys.argv[1]))
assert j["org_id"] == "ext-operator-org-1"
assert j["bundle"]["operators"][0]["org_id"] == "ext-operator-org-1"
print("signed_slug="+j["bundle"]["operators"][0]["slug"])
PY
python3 -c 'import json,sys; j=json.load(open(sys.argv[1])); json.dump(j["bundle"], open(sys.argv[2],"w"))' "$WORKDIR/join.json" "$WORKDIR/bundle.json"

echo "--- reconstruct without control-api ---"
(cd "$API_DIR" && go run ./cmd/w7b-manifest-bundle verify "$WORKDIR/bundle.json")
echo "W7D_JOIN_CLI_OK"

if [[ "${CONFIRM_W7D_EXTERNAL_VPS:-}" == "1" ]]; then
  echo "--- live volunteer VPS (operator must already be in directory/bundle) ---"
  LIVE=$(curl -fsS "$API/v1/system/config/public" | python3 -c 'import json,sys; g=(json.load(sys.stdin).get("gateway_operators") or {}); print(g.get("operator_org_diversity"))')
  echo "live_org_diversity=$LIVE"
  [[ "$LIVE" == "multi_org" ]] || { echo "FAIL: expected operator_org_diversity=multi_org"; exit 2; }
  echo "W7D_EXTERNAL_VPS_OK"
else
  echo "W7D_EXTERNAL_VPS_SKIPPED (set CONFIRM_W7D_EXTERNAL_VPS=1 after a foreign org is cached)"
fi
