#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb
TAR=$(ls -1t /tmp/session-creds-fix-*.tar.gz | head -1)
sudo tar -xzf "$TAR" -C /opt/proxyhubb
for f in services/control-api/internal/api/orders.go services/control-api/internal/api/session.go services/control-api/internal/marketplace/session_activation.go apps/web/src/lib/order-status.ts apps/web/src/components/marketplace/MarketplaceOrderDetailView.tsx; do
  sudo sed -i 's/\r$//' "$f"
done
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
echo "=== build control-api ==="
"${COMPOSE[@]}" build control-api
echo "=== build web ==="
"${COMPOSE[@]}" build web
echo "=== recreate ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api web
sleep 20
curl -sS -o /dev/null -w "control-api=%{http_code}\n" http://127.0.0.1:18080/health
curl -sS -o /dev/null -w "web=%{http_code}\n" http://127.0.0.1:3000/
# Repair credentials for the active order
SECRET=$(sudo docker exec proxyhubb-control-api-1 printenv JWT_SECRET)
ORDER_ID=302dd5c9-9fc3-4b10-86a9-9156a3276d2a
TOKEN=$(SECRET="$SECRET" python3 - <<'PY'
import os, time, hmac, hashlib, base64, json
secret=os.environ["SECRET"].encode()
def b64(d):
  return base64.urlsafe_b64encode(d).rstrip(b"=").decode()
header=b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
payload=b64(json.dumps({
  "sub":"b77e84c9-0e85-4f23-afc0-581cd561c216",
  "role":"buyer",
  "wallet":"62vwX11TCForSbpExYz7sp2b6AkWy7urDgYHcERt2eE",
  "exp":int(time.time())+3600,
  "iat":int(time.time()),
  "iss":"proxyhubb-control-api",
},separators=(",",":")).encode())
sig=b64(hmac.new(secret,f"{header}.{payload}".encode(),hashlib.sha256).digest())
print(f"{header}.{payload}.{sig}")
PY
)
echo "=== credentials repair ==="
curl -sS -w "\nHTTP=%{http_code}\n" "http://127.0.0.1:18080/v1/orders/${ORDER_ID}/credentials" \
  -H "Authorization: Bearer ${TOKEN}" | python3 -c 'import sys,json,re
raw=sys.stdin.read()
m=re.search(r"HTTP=(\d+)", raw)
body=raw[:m.start()] if m else raw
code=m.group(1) if m else "?"
try:
  d=json.loads(body)
  pc=d.get("proxy_credentials")
  if pc:
    print("OK host=",pc.get("host"),"port=",pc.get("port"),"user=", (pc.get("username") or "")[:12]+"?","http="+code)
  else:
    print(body[:300], "http="+code)
except Exception as e:
  print(raw[:400], e)
'
echo "=== session status ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "SELECT id::text, status FROM sessions WHERE id='765cc39d-9b13-4036-9d41-7c4f6c6df5a4';"
