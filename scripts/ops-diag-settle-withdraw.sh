#!/usr/bin/env bash
# Diagnose settle/withdraw RPC health on gcp-testnet.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== control-api Solana RPC env ==="
"${COMPOSE[@]}" exec -T control-api sh -c 'printenv | grep -E "^SOLANA_RPC" | sed "s/\(api[_-]key[^ =]*=\).*/\1***/i"' || true

echo "=== RPC latency probe (primary + fallbacks) ==="
python3 - <<'PY'
import json, os, time, urllib.request
endpoints=[]
# pull from control-api via docker
import subprocess
out=subprocess.check_output([
  "docker","compose","-f","docker-compose.yml","-f","docker-compose.testnet.yml","-f","docker-compose.gcp-testnet.yml",
  "exec","-T","control-api","printenv","SOLANA_RPC_ENDPOINTS"
], text=True).strip()
primary=subprocess.check_output([
  "docker","compose","-f","docker-compose.yml","-f","docker-compose.testnet.yml","-f","docker-compose.gcp-testnet.yml",
  "exec","-T","control-api","printenv","SOLANA_RPC_ENDPOINT"
], text=True).strip()
for e in [primary] + [x.strip() for x in out.split(",") if x.strip()]:
  if e and e not in endpoints:
    endpoints.append(e)
payload=json.dumps({"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[{"commitment":"confirmed"}]}).encode()
for url in endpoints:
  t0=time.time()
  try:
    req=urllib.request.Request(url, data=payload, headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=12) as r:
      body=r.read().decode()
    ms=int((time.time()-t0)*1000)
    j=json.loads(body)
    if "error" in j:
      print(f"FAIL {ms}ms {url} err={j['error']}")
    else:
      print(f"OK   {ms}ms {url} slot={j.get('result',{}).get('context',{}).get('slot')}")
  except Exception as e:
    ms=int((time.time()-t0)*1000)
    print(f"FAIL {ms}ms {url} {type(e).__name__}: {e}")
PY

echo "=== hot wallet + balances ==="
HOT=$("${COMPOSE[@]}" exec -T control-api printenv TREASURY_HOT_WALLET 2>/dev/null | tr -d '\r' || true)
[[ -z "$HOT" ]] && HOT=$("${COMPOSE[@]}" exec -T control-api printenv HOT_WALLET_PUBKEY 2>/dev/null | tr -d '\r' || true)
echo "HOT=$HOT"
VAULT=$("${COMPOSE[@]}" exec -T control-api printenv TREASURY_VAULT_ADDRESS 2>/dev/null | tr -d '\r' || true)
echo "VAULT=$VAULT"

echo "=== recent settle_queued / release orders ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT id, status, payment_method, left(coalesce(escrow_pda,''),20) AS pda, updated_at FROM orders WHERE status IN ('active','settle_queued','settling','completed') AND payment_method ILIKE '%escrow%' ORDER BY updated_at DESC LIMIT 8;"

echo "=== seller wallet available ==="
SELLER=b77e84c9-0e85-4f23-afc0-581cd561c216
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT id, balance_sol, locked_sol, (balance_sol - coalesce(locked_sol,0)) AS available FROM wallets WHERE user_id='$SELLER';"

echo "=== withdraw-related control-api logs ==="
docker logs proxyhubb-control-api-1 --since 2h 2>&1 | grep -iE 'withdraw|payout balance|hot balance|treasury|settle|release|blockhash|429|Too Many' | tail -40 || true

echo SETTLE_WITHDRAW_DIAG_DONE
