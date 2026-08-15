#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
test -f scripts/gcp-topup-hot-from-cold.sh
test -f /opt/proxyhubb/secrets/treasury-cold-keypair.json
sed -i 's/\r$//' scripts/gcp-topup-hot-from-cold.sh
bash scripts/gcp-topup-hot-from-cold.sh 6

echo "=== mounts (cold must stay off) ==="
MOUNTS=$(docker inspect proxyhubb-control-api-1 --format '{{range .Mounts}}{{.Destination}};{{end}}')
echo "mounts=$MOUNTS"
echo "$MOUNTS" | grep -qi cold && { echo FAIL_COLD_MOUNTED; exit 1; } || echo COLD_NOT_MOUNTED_OK

echo "=== treasury public ==="
curl -fsS --max-time 15 http://127.0.0.1:8080/v1/treasury/public > /tmp/treasury-public-after-topup.json
python3 <<'PY'
import json
d=json.load(open("/tmp/treasury-public-after-topup.json"))
t=d.get("treasury") or d
h=t.get("hot") or {}
bal=float(h.get("balance_sol") or 0)
needs=bool(h.get("needs_replenish"))
print("status", t.get("status"))
print("hot_sol", bal, "needs", needs)
if bal >= 5 and not needs:
    print("TOPUP_STATUS_OK")
else:
    print("TOPUP_CHECK_REVIEW")
    raise SystemExit(1)
PY
echo "SPRINT_F_TOPUP_OK"
