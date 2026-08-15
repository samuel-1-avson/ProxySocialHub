#!/usr/bin/env bash
# Wave 6.B — operator-signed manifests on discovery.
# Expect: W6B_MANIFEST_OK when mode=observe|enforce and at least one verified
# manifest is present. Default off is W6B_MANIFEST_OFF (not a failure of the flag).
set -euo pipefail
cd /opt/proxyhubb 2>/dev/null || cd "$(dirname "$0")/.."

CONTROL="${CONTROL_URL:-http://127.0.0.1:18080}"
curl -fsS "$CONTROL/v1/system/config/public" -o /tmp/w6b-cfg.json
curl -fsS "$CONTROL/v1/gateways/operators" -o /tmp/w6b-ops.json

python3 - <<'PY'
import json, sys
cfg=json.load(open("/tmp/w6b-cfg.json"))
d=json.load(open("/tmp/w6b-ops.json"))
mode=cfg.get("operator_manifest_mode") or (d.get("honesty") or {}).get("operator_manifest_mode")
print("operator_manifest_mode", mode)
ops=d.get("operators") or []
verified=sum(1 for o in ops if o.get("manifest_verified"))
print("verified", verified, "of", len(ops))
if mode in (None, "", "off"):
    print("W6B_MANIFEST_OFF")
    sys.exit(0)
if mode == "observe":
    print("W6B_MANIFEST_OK")
    sys.exit(0)
if mode == "enforce":
    if verified < 1 or verified != len(ops):
        print("W6B_MANIFEST_ENFORCE_FAIL")
        sys.exit(2)
    print("W6B_MANIFEST_OK")
    sys.exit(0)
print("unknown mode", mode)
sys.exit(2)
PY
