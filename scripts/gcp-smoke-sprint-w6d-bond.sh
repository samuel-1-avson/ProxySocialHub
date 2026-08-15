#!/usr/bin/env bash
# Wave 6.D — bond-enforce mode honesty (default off).
# Expect: W6D_BOND_OK
set -euo pipefail
cd /opt/proxyhubb 2>/dev/null || cd "$(dirname "$0")/.."
CONTROL="${CONTROL_URL:-http://127.0.0.1:18080}"

curl -fsS "$CONTROL/v1/system/config/public" -o /tmp/w6d-cfg.json
python3 - <<'PY'
import json
d=json.load(open("/tmp/w6d-cfg.json"))
mode=d.get("gateway_operator_bond_mode")
enf=d.get("gateway_operator_bond_enforce")
print("bond_mode", mode, "bond_enforce", enf)
go=d.get("gateway_operators") or {}
print("live_economic_slash", go.get("live_economic_slash"))
print("programs_session", go.get("programs_session"))
assert go.get("live_economic_slash") is False
assert go.get("programs_session") == "unsafe_do_not_deploy"
assert mode in ("off", "observe", "enforce"), mode
print("W6D_BOND_OK")
PY
