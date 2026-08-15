#!/usr/bin/env bash
# Wave 5.B — gateway operator discovery smoke.
# Expect: W5B_OPERATORS_OK
set -euo pipefail
cd /opt/proxyhubb 2>/dev/null || cd "$(dirname "$0")/.."

CONTROL="${CONTROL_URL:-http://127.0.0.1:18080}"

echo "=== W5.B: discovery lists two active operators ==="
curl -fsS "$CONTROL/v1/gateways/operators" -o /tmp/w5b-ops.json
python3 - <<'PY'
import json
d=json.load(open("/tmp/w5b-ops.json"))
ops=d.get("operators") or []
assert len(ops) >= 2, ops
slugs={o.get("slug") for o in ops}
assert "edge-a" in slugs and "edge-b" in slugs, slugs
healthy=sum(1 for o in ops if o.get("healthy"))
print("count", len(ops), "healthy", healthy, "bond_enforce", d.get("bond_enforce"))
assert d.get("bond_enforce") is False, d.get("bond_enforce")
print("honesty", (d.get("honesty") or "")[:80])
PY

echo "=== W5.B: public config exposes bond_enforce ==="
curl -fsS "$CONTROL/v1/system/config/public" -o /tmp/w5b-cfg.json
python3 - <<'PY'
import json
d=json.load(open("/tmp/w5b-cfg.json"))
assert "gateway_operator_bond_enforce" in d, d.keys()
print("gateway_operator_bond_enforce", d.get("gateway_operator_bond_enforce"))
PY

echo "W5B_OPERATORS_OK"
