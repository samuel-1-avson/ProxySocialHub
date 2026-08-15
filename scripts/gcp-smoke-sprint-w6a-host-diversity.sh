#!/usr/bin/env bash
# Wave 6.A — host diversity honesty (does not provision a VM).
# Expect: W6A_HOST_DIVERSITY_OK when API reports two_hosts.
# On current same-VM J2 this script exits 2 with W6A_SAME_HOST (honest).
set -euo pipefail
cd /opt/proxyhubb 2>/dev/null || cd "$(dirname "$0")/.."

CONTROL="${CONTROL_URL:-http://127.0.0.1:18080}"

curl -fsS "$CONTROL/v1/gateways/operators" -o /tmp/w6a-ops.json
python3 - <<'PY'
import json, sys
d=json.load(open("/tmp/w6a-ops.json"))
h=d.get("honesty") or {}
if isinstance(h, str):
    print("honesty_legacy", h[:80])
    sys.exit(2)
div=h.get("operator_host_diversity")
print("operator_host_diversity", div)
print("control_plane", h.get("control_plane"))
print("bond_enforce_mode", h.get("bond_enforce_mode"))
ops=d.get("operators") or []
print("operators", [(o.get("slug"), o.get("host_id")) for o in ops])
if h.get("control_plane") != "shared":
    raise SystemExit("control_plane must remain shared")
if div == "two_hosts":
    print("W6A_HOST_DIVERSITY_OK")
    sys.exit(0)
print("W6A_SAME_HOST — set GATEWAY_OP_B_HOST_ID + external tunnel on a second VM")
sys.exit(2)
PY
