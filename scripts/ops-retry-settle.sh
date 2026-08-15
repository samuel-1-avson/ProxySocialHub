#!/usr/bin/env bash
# After RPC cool-down: retry release for a settle_queued order + re-check outbox.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
API="${API:-http://127.0.0.1:18080}"
OID="${1:-834c182a-3346-4d93-9cd5-7e1c3bdeb61f}"
BUYER=76609a25-0b69-4e05-9640-4c67d7a07f36

echo "=== wait 45s for RPC cool-down ==="
sleep 45

echo "=== order state ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT id, status, escrow_pda, tx_signature FROM orders WHERE id='$OID';"

echo "=== outbox rows ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT id, kind, status, attempts, left(coalesce(last_error,''),120) AS err, updated_at FROM compensation_outbox ORDER BY updated_at DESC LIMIT 8;" 2>&1 | head -40

SECRET=$("${COMPOSE[@]}" exec -T control-api sh -c 'printenv JWT_SECRET || printenv SUPABASE_JWT_SECRET' | tr -d '\r' | head -n1)
TOKEN=$(SECRET="$SECRET" USER_ID="$BUYER" python3 - <<'PY'
import os,time,hmac,hashlib,base64,json
sec=os.environ["SECRET"].encode(); uid=os.environ["USER_ID"]
b64=lambda d: base64.urlsafe_b64encode(d).rstrip(b"=").decode()
h=b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
p=b64(json.dumps({"sub":uid,"user_id":uid,"role":"buyer","exp":int(time.time())+3600},separators=(",",":")).encode())
s=b64(hmac.new(sec,f"{h}.{p}".encode(),hashlib.sha256).digest())
print(f"{h}.{p}.{s}")
PY
)

echo "=== probe blockhash before release ==="
python3 - <<'PY'
import json,urllib.request,time
for url in ["https://api.devnet.solana.com","https://solana-devnet.api.onfinality.io/public"]:
  payload=json.dumps({"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[{"commitment":"confirmed"}]}).encode()
  t0=time.time()
  try:
    req=urllib.request.Request(url,data=payload,headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=12) as r:
      j=json.loads(r.read().decode())
    print("OK", int((time.time()-t0)*1000), url, "err" if "error" in j else "ok")
  except Exception as e:
    print("FAIL", int((time.time()-t0)*1000), url, e)
PY

for i in 1 2 3 4 5; do
  CODE=$(curl -sS -o /tmp/rel2.json -w '%{http_code}' -X POST "$API/v1/escrow/$OID/release" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' || echo 000)
  echo "release retry $i HTTP=$CODE body=$(head -c 300 /tmp/rel2.json)"
  if [[ "$CODE" == "200" ]]; then
    echo RELEASE_RETRY_OK
    break
  fi
  sleep 8
done

"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT id, status, left(coalesce(tx_signature,''),40) AS tx FROM orders WHERE id='$OID';"

echo SETTLE_RETRY_DONE
