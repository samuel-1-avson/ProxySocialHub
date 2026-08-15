#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
sed -i 's/\r$//' /tmp/treasury_manager.go /tmp/control-api-main.go
cp -f /tmp/treasury_manager.go services/control-api/internal/treasury/treasury_manager.go
cp -f /tmp/control-api-main.go services/control-api/main.go
bash scripts/ops-rebuild-control-api.sh
sleep 5
python3 - <<'PY'
import json, urllib.request
for url in ("http://127.0.0.1:18080/v1/treasury/public", "https://api.proxyhubb.com/v1/treasury/public"):
    try:
        with urllib.request.urlopen(url, timeout=25) as r:
            d = json.loads(r.read().decode())
    except Exception as e:
        print(url, "ERR", e)
        continue
    t = d.get("treasury") or {}
    print("url", url)
    print(" status", t.get("status"))
    for k in ("hot", "vault", "cold"):
        w = t.get(k) or {}
        print(f" {k}", w.get("balance_sol"), "unavailable=", w.get("balance_unavailable"))
PY
echo TREASURY_RPC_FIX_DONE
