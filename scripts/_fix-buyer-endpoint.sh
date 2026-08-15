#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb
# Show current values without secrets
grep -nE 'EDGE_GATEWAY_BUYER_HOST|NEXT_PUBLIC_PROXY_ENDPOINT|GATEWAY_PUBLIC_URL|PROVIDER_TUNNEL_PUBLIC_ADDR|PROVIDER_PUBLIC_CONTROL_API_URL' .env docker-compose*.yml 2>/dev/null | head -40
# Fix .env placeholders
if [ -f .env ]; then
  sudo cp .env ".env.bak.endpoint-$(date +%Y%m%d%H%M%S)"
  sudo sed -i \
    -e 's|^EDGE_GATEWAY_BUYER_HOST=.*|EDGE_GATEWAY_BUYER_HOST=proxy.proxyhubb.com|' \
    -e 's|^NEXT_PUBLIC_PROXY_ENDPOINT=.*|NEXT_PUBLIC_PROXY_ENDPOINT=proxy.proxyhubb.com:8090|' \
    -e 's|^GATEWAY_PUBLIC_URL=.*|GATEWAY_PUBLIC_URL=https://proxy.proxyhubb.com|' \
    -e 's|^PROVIDER_PUBLIC_CONTROL_API_URL=.*|PROVIDER_PUBLIC_CONTROL_API_URL=https://api.proxyhubb.com|' \
    .env
  # Ensure keys exist if missing
  grep -q '^EDGE_GATEWAY_BUYER_HOST=' .env || echo 'EDGE_GATEWAY_BUYER_HOST=proxy.proxyhubb.com' | sudo tee -a .env >/dev/null
  grep -q '^NEXT_PUBLIC_PROXY_ENDPOINT=' .env || echo 'NEXT_PUBLIC_PROXY_ENDPOINT=proxy.proxyhubb.com:8090' | sudo tee -a .env >/dev/null
  grep -q '^EDGE_GATEWAY_BUYER_PORT=' .env || echo 'EDGE_GATEWAY_BUYER_PORT=8090' | sudo tee -a .env >/dev/null
fi
echo "=== after ==="
grep -E '^(EDGE_GATEWAY_BUYER_HOST|NEXT_PUBLIC_PROXY_ENDPOINT|GATEWAY_PUBLIC_URL|PROVIDER_TUNNEL_PUBLIC_ADDR|PROVIDER_PUBLIC_CONTROL_API_URL|EDGE_GATEWAY_BUYER_PORT)=' .env
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
# control-api reads env at runtime ? recreate is enough for credentials host
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
sleep 15
echo "=== verify env in container ==="
sudo docker exec proxyhubb-control-api-1 sh -c 'env' | grep -E 'EDGE_GATEWAY_BUYER_HOST|EDGE_GATEWAY_BUYER_PORT|NEXT_PUBLIC_PROXY'
# Smoke: credentials host via mint jwt
SECRET=$(sudo docker exec proxyhubb-control-api-1 printenv JWT_SECRET)
ORDER_ID=302dd5c9-9fc3-4b10-86a9-9156a3276d2a
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
curl -sS "http://127.0.0.1:18080/v1/orders/${ORDER_ID}/credentials" -H "Authorization: Bearer ${TOKEN}" | python3 -c 'import sys,json; d=json.load(sys.stdin); pc=d["proxy_credentials"]; print("endpoint=",pc.get("endpoint"),"host=",pc.get("host"),"port=",pc.get("port"))'
# TCP reachability of buyer port
echo "=== tcp 8090 ==="
timeout 3 bash -c 'echo >/dev/tcp/127.0.0.1/8090' && echo local_8090_ok || echo local_8090_fail
curl -sS -o /dev/null -w "proxy_dns=%{http_code} resolve=%{remote_ip}\n" --connect-timeout 5 http://proxy.proxyhubb.com:8090/health || true
