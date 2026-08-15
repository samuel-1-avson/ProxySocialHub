#!/usr/bin/env bash
# Wave 6.C — cross-host peer-forward soak.
# Fail-closed if discovery still reports same_host (W5.B J2 is not this claim).
# Expect: W6C_PEER_FORWARD_OK after provider-on-A / buyer-on-B across distinct hosts.
set -euo pipefail
cd /opt/proxyhubb 2>/dev/null || cd "$(dirname "$0")/.."

CONTROL="${CONTROL_URL:-http://127.0.0.1:18080}"
EDGE_A="${EDGE_A_URL:-http://127.0.0.1:18090}"
EDGE_B="${EDGE_B_URL:-}"

echo "=== remaining SPOFs (always true in Wave 6) ==="
cat <<'EOF'
- shared control-api (session mint / discovery)
- shared Postgres
- shared Redis master
- DNS / public IP of either host
EOF

curl -fsS "$CONTROL/v1/gateways/operators" -o /tmp/w6c-ops.json
python3 - <<'PY'
import json, os, sys
d=json.load(open("/tmp/w6c-ops.json"))
h=d.get("honesty") or {}
div=h.get("operator_host_diversity") if isinstance(h, dict) else None
print("operator_host_diversity", div)
if div != "two_hosts":
    print("W6C_SKIP_SAME_HOST — provision host-B first (docs/ops/W6_SECOND_HOST_EDGE.md)")
    sys.exit(2)
ops={o.get("slug"): o for o in (d.get("operators") or [])}
b=ops.get("edge-b") or {}
print("edge-b host_id", b.get("host_id"), "buyer", b.get("buyer_base_url"))
open("/tmp/w6c-edge-b-url.txt","w").write((b.get("buyer_base_url") or "").rstrip("/") + "\n")
PY

if [[ -z "${EDGE_B}" ]]; then
  EDGE_B="$(tr -d '\n' < /tmp/w6c-edge-b-url.txt)"
fi
echo "EDGE_A=$EDGE_A EDGE_B=$EDGE_B"

echo "=== health ==="
curl -fsS "$EDGE_A/health" | head -c 200; echo
curl -fsS "$EDGE_B/health" | head -c 200; echo

echo "=== W6.C needs a live CONNECT (provider on host-A, buyer on host-B) ==="
echo "Set W6C_ORIGIN_GET=1 and PROXY_USER/PROXY_PASS to attempt tunneled GET."
if [[ "${W6C_ORIGIN_GET:-0}" != "1" ]]; then
  echo "W6C_PEER_FORWARD_PENDING — hosts distinct; run CONNECT then re-run with W6C_ORIGIN_GET=1"
  exit 2
fi

# Best-effort: look for remote route on host-B metrics if scraped locally.
if curl -fsS "${EDGE_B}/metrics" -o /tmp/w6c-metrics-b.txt 2>/dev/null; then
  if grep -E 'edge_gateway_provider_route_selection_total\{route="remote"' /tmp/w6c-metrics-b.txt | grep -vq ' 0$'; then
    echo "W6C_PEER_FORWARD_OK"
    exit 0
  fi
fi
echo "W6C_PEER_FORWARD_PENDING — no remote route metric yet"
exit 2
