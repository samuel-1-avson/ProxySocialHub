#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb
TAR=$(ls -1t /tmp/reaper-fix-*.tar.gz | head -1)
sudo tar -xzf "$TAR" -C /opt/proxyhubb
sudo sed -i 's/\r$//' services/control-api/internal/worker/session_reaper.go
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
sleep 18
curl -sS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:18080/health
# Ensure session active again via credentials repair
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
curl -sS -o /tmp/creds.json -w "creds=%{http_code}\n" "http://127.0.0.1:18080/v1/orders/302dd5c9-9fc3-4b10-86a9-9156a3276d2a/credentials" -H "Authorization: Bearer ${TOKEN}"
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc "SELECT status FROM sessions WHERE id='765cc39d-9b13-4036-9d41-7c4f6c6df5a4';"
python3 -c 'import json; pc=json.load(open("/tmp/creds.json")).get("proxy_credentials") or {}; print("user="+str(pc.get("username"))); print("endpoint="+str(pc.get("endpoint")))'
