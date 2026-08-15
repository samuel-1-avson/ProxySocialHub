#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb
sudo cp .env ".env.bak.endpoint-$(date +%Y%m%d%H%M%S)"
sudo sed -i \
  -e 's|^EDGE_GATEWAY_BUYER_HOST=.*|EDGE_GATEWAY_BUYER_HOST=proxy.proxyhubb.com|' \
  -e 's|^GATEWAY_PUBLIC_URL=.*|GATEWAY_PUBLIC_URL=https://proxy.proxyhubb.com|' \
  -e 's|^NEXT_PUBLIC_PROXY_ENDPOINT=.*|NEXT_PUBLIC_PROXY_ENDPOINT=proxy.proxyhubb.com:8090|' \
  -e 's|^PROVIDER_PUBLIC_CONTROL_API_URL=.*|PROVIDER_PUBLIC_CONTROL_API_URL=https://api.proxyhubb.com|' \
  .env
# Add missing keys
sudo grep -q '^EDGE_GATEWAY_BUYER_HOST=' .env || echo 'EDGE_GATEWAY_BUYER_HOST=proxy.proxyhubb.com' | sudo tee -a .env >/dev/null
sudo grep -q '^NEXT_PUBLIC_PROXY_ENDPOINT=' .env || echo 'NEXT_PUBLIC_PROXY_ENDPOINT=proxy.proxyhubb.com:8090' | sudo tee -a .env >/dev/null
sudo grep -q '^EDGE_GATEWAY_BUYER_PORT=' .env || echo 'EDGE_GATEWAY_BUYER_PORT=8090' | sudo tee -a .env >/dev/null
echo "=== .env buyer endpoint ==="
sudo grep -E '^(EDGE_GATEWAY_BUYER_HOST|EDGE_GATEWAY_BUYER_PORT|NEXT_PUBLIC_PROXY_ENDPOINT|GATEWAY_PUBLIC_URL|PROVIDER_TUNNEL_PUBLIC_ADDR)=' .env
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
sleep 18
echo "=== container ==="
sudo docker exec proxyhubb-control-api-1 printenv EDGE_GATEWAY_BUYER_HOST
sudo docker exec proxyhubb-control-api-1 printenv EDGE_GATEWAY_BUYER_PORT
SECRET=$(sudo docker exec proxyhubb-control-api-1 printenv JWT_SECRET)
TOKEN=$(SECRET="$SECRET" python3 - <<'PY'
import os, time, hmac, hashlib, base64, json
secret=os.environ["SECRET"].encode()
def b64(d):
  return base64.urlsafe_b64encode(d).rstrip(b"=").decode()
header=b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
payload=b64(json.dumps({"sub":"b77e84c9-0e85-4f23-afc0-581cd561c216","role":"buyer","exp":int(time.time())+3600,"iat":int(time.time()),"iss":"proxyhubb-control-api"},separators=(",",":")).encode())
sig=b64(hmac.new(secret,f"{header}.{payload}".encode(),hashlib.sha256).digest())
print(f"{header}.{payload}.{sig}")
PY
)
curl -sS "http://127.0.0.1:18080/v1/orders/302dd5c9-9fc3-4b10-86a9-9156a3276d2a/credentials" -H "Authorization: Bearer ${TOKEN}" | python3 -c 'import sys,json; d=json.load(sys.stdin); pc=d["proxy_credentials"]; print("endpoint="+str(pc.get("endpoint")))'
