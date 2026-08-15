#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== control-api SOLANA_RPC (masked) ==="
"${COMPOSE[@]}" exec -T control-api sh -c 'printenv SOLANA_RPC_ENDPOINT; printenv SOLANA_RPC_ENDPOINTS' \
  | sed -E 's/(api-key=)[^&[:space:]]+/\1***/g'

echo "=== public treasury API ==="
curl -sS -m 25 https://api.proxyhubb.com/v1/treasury/public | head -c 1200; echo
curl -sS -m 25 http://127.0.0.1:18080/v1/treasury/public | head -c 1200; echo

echo "=== probe primary RPC getBalance vault ==="
RPC=$(grep -E '^SOLANA_RPC_ENDPOINT=' .env | head -1 | cut -d= -f2- | tr -d '\r')
python3 - <<PY
import json,urllib.request,os,re
env=open(".env",encoding="utf-8",errors="ignore").read()
m=re.search(r"^SOLANA_RPC_ENDPOINT=(.+)$",env,re.M)
rpc=(m.group(1).strip() if m else "").strip()
print("rpc_host", rpc.split("?")[0])
for name,addr in [
 ("vault","8LZji2G9nn7ywoLwopgcREpm5xQHpvRJY1az1R9hHRzm"),
 ("hot","FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3"),
 ("cold","3MrGGqkGKSfmgBBY8s537HX2Sk4zK4qCHCDdW3yGwCCZ"),
]:
  req=urllib.request.Request(rpc,data=json.dumps({"jsonrpc":"2.0","id":1,"method":"getBalance","params":[addr]}).encode(),headers={"Content-Type":"application/json"})
  try:
    with urllib.request.urlopen(req,timeout=20) as r:
      j=json.loads(r.read().decode())
    print(name, j.get("result") or j.get("error"))
  except Exception as e:
    print(name, "ERR", e)
PY

echo "=== control-api recent RPC errors ==="
docker logs proxyhubb-control-api-1 --since 30m 2>&1 | grep -iE 'RPC_UNAVAILABLE|getBalance|treasury|429|helius|blockhash|solana' | tail -40 || true
