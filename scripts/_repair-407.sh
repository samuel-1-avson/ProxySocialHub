#!/bin/bash
set -euo pipefail
# Repair: hit credentials endpoint which resurrects terminated session for active order
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
CODE=$(curl -sS -o /tmp/creds.json -w "%{http_code}" "http://127.0.0.1:18080/v1/orders/302dd5c9-9fc3-4b10-86a9-9156a3276d2a/credentials" -H "Authorization: Bearer ${TOKEN}")
echo "HTTP=$CODE"
python3 - <<'PY'
import json
d=json.load(open("/tmp/creds.json"))
pc=d.get("proxy_credentials") or {}
print("host=", pc.get("host"))
print("port=", pc.get("port"))
print("user=", pc.get("username"))
print("pass_len=", len(pc.get("password") or ""))
print("endpoint=", pc.get("endpoint"))
PY
echo "=== session status ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc "SELECT status FROM sessions WHERE id='765cc39d-9b13-4036-9d41-7c4f6c6df5a4';"
echo "=== what terminated it ==="
sudo docker logs --since=6h proxyhubb-control-api-1 2>&1 | grep -E '765cc39d|DELETE.*/v1/sessions|Ghost detected|terminate' | tail -40
