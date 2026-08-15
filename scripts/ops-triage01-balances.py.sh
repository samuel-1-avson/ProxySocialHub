#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
cd "$PROJECT_DIR"
echo "=== S8 REPORT (latest) ==="
ls -1t docs/ops/evidence/S8_dr_*.md 2>/dev/null | head -1 | xargs -r cat
echo
python3 <<'PY'
import json, urllib.request, time, re
env = open(".env", encoding="utf-8", errors="ignore").read()
m = re.search(r"^SOLANA_RPC_ENDPOINT=(.+)$", env, re.M)
rpc = (m.group(1).strip() if m else "").strip()
if not rpc:
    m = re.search(r"^SOLANA_RPC_ENDPOINTS=([^,\r\n]+)", env, re.M)
    rpc = m.group(1).strip() if m else "https://solana-devnet.api.onfinality.io/public"
print("rpc", rpc.split("?")[0])
addrs = {
    "vault": re.search(r"^SOLANA_TREASURY_ADDRESS=(.+)$", env, re.M).group(1).strip(),
    "hot": re.search(r"^SOLANA_TREASURY_HOT_ADDRESS=(.+)$", env, re.M).group(1).strip(),
    "cold": re.search(r"^SOLANA_TREASURY_COLD_ADDRESS=(.+)$", env, re.M).group(1).strip(),
}
vals = {}
for name, a in addrs.items():
    print(f"{name}_addr={a}")
    ok = False
    for attempt in range(6):
        try:
            body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "getBalance", "params": [a]}).encode()
            req = urllib.request.Request(rpc, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=40) as r:
                v = json.load(r)["result"]["value"]
            vals[name] = v
            print(f"{name}_lamports={v} sol={v/1e9:.9f}")
            ok = True
            break
        except Exception as e:
            print(f"{name} retry {attempt}: {e}")
            time.sleep(2 * (attempt + 1))
    if not ok:
        vals[name] = None
        print(f"{name}=FAILED")
if all(v is not None for v in vals.values()):
    liab = 15419956447
    comb = vals["vault"] + vals["hot"]
    print(f"combined_vault_hot_sol={comb/1e9:.9f}")
    print(f"liabilities_sol={liab/1e9:.9f}")
    print(f"deficit_sol={(liab-comb)/1e9:.9f}")
    print(f"cold_included_net_sol={(comb+vals['cold']-liab)/1e9:.9f}")
PY
