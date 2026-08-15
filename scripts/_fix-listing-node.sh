#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb
TAR=$(ls -1t /tmp/listing-node-fallback-*.tar.gz | head -1)
sudo tar -xzf "$TAR" -C /opt/proxyhubb
sudo sed -i 's/\r$//' services/control-api/internal/marketplace/provider_node.go services/control-api/internal/api/provider_nodes.go

# Rebind ghana listing to the only non-deleted online node (q / 9f71b93c...)
ACTIVE_NODE=9f71b93c-27b0-4c73-92b5-a73526e48ced
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 -c "
UPDATE proxy_listings
SET provider_node_id = '${ACTIVE_NODE}'
WHERE id = 'c1472dbc-dee3-407e-8fea-ec3ed42489ac';
UPDATE provider_nodes
SET deleted_at = NULL, status = 'online', is_healthy = true, last_seen_at = NOW()
WHERE id = '${ACTIVE_NODE}' AND user_id = 'b77e84c9-0e85-4f23-afc0-581cd561c216';
SELECT id::text, provider_node_id::text FROM proxy_listings WHERE id='c1472dbc-dee3-407e-8fea-ec3ed42489ac';
"

COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
sleep 18
curl -sS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:18080/health

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
echo "=== repair credentials ==="
curl -sS -o /tmp/creds.json -w "creds=%{http_code}\n" "http://127.0.0.1:18080/v1/orders/302dd5c9-9fc3-4b10-86a9-9156a3276d2a/credentials" -H "Authorization: Bearer ${TOKEN}"
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "
SELECT o.status AS order_status, s.status AS session_status
FROM orders o LEFT JOIN sessions s ON s.id=o.session_id
WHERE o.id='302dd5c9-9fc3-4b10-86a9-9156a3276d2a';
"
python3 -c 'import json; pc=json.load(open("/tmp/creds.json")).get("proxy_credentials") or {}; print("endpoint="+str(pc.get("endpoint"))); print("user="+str(pc.get("username"))); print("pass_len="+str(len(pc.get("password") or "")))'
echo "ACTIVE_NODE_ID=${ACTIVE_NODE}"
