#!/usr/bin/env bash
# Wave 5.C.2 — credential proof enforce on CONNECT (marketplace Redis session).
set -euo pipefail
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"
EDGE="${EDGE_BUYER_URL:-http://127.0.0.1:18091}"
EDGE_HOST="${EDGE_BUYER_HOST:-127.0.0.1}"
EDGE_PORT="${EDGE_BUYER_PORT:-18091}"

echo "=== W5.C.2 credential proof enforce ==="
MODE_API=$(sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_CREDENTIAL_PROOF | tr -d '\r')
MODE_EDGE=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv PROXYHUB_CREDENTIAL_PROOF | tr -d '\r' || true)
echo "control_api_mode=$MODE_API edge_b_mode=${MODE_EDGE:-unset}"
[[ "$MODE_API" == "enforce" ]] || { echo "FAIL: control-api not enforce"; exit 2; }
[[ "${MODE_EDGE:-}" == "enforce" ]] || { echo "FAIL: edge-b not enforce"; exit 2; }

PASS=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv REDIS_URL | sed -n 's|redis://:\([^@]*\)@.*|\1|p' | tr -d '\r')
REDIS_HOST=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv REDIS_URL | sed -n 's|redis://:[^@]*@\([^:]*\):.*|\1|p' | tr -d '\r')
REDIS_CTR=proxyhubb-redis-1
[[ "$REDIS_HOST" == "redis-replica" ]] && REDIS_CTR=proxyhubb-redis-replica-1
SESSION_SECRET=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv SESSION_SECRET | tr -d '\r')

USER="w5c2-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
PW="w5c2-pass-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
ORDER_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
SESSION_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
BUYER_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
LISTING_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EXP=$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ)
ISSUED=$(date -u +%s)
EXPIRES=$((ISSUED + 7200))

build_session() {
  local with_proof="$1"
  SESSION_SECRET="$SESSION_SECRET" USER="$USER" PW="$PW" ORDER_ID="$ORDER_ID" SESSION_ID="$SESSION_ID" \
  BUYER_ID="$BUYER_ID" LISTING_ID="$LISTING_ID" NOW="$NOW" EXP="$EXP" ISSUED="$ISSUED" EXPIRES="$EXPIRES" \
  WITH_PROOF="$with_proof" python3 - <<'PY'
import hashlib, hmac, json, os
user = os.environ["USER"]
pw = os.environ["PW"]
order_id = os.environ["ORDER_ID"]
session_id = os.environ["SESSION_ID"]
buyer_id = os.environ["BUYER_ID"]
listing_id = os.environ["LISTING_ID"]
issued = int(os.environ["ISSUED"])
expires = int(os.environ["EXPIRES"])
username_hash = hashlib.sha256(user.encode()).hexdigest()
cred_hash = hashlib.sha256(pw.encode()).hexdigest()
payload = {
  "user_id": buyer_id,
  "session_id": session_id,
  "provider_id": "",
  "type": "sticky",
  "status": "active",
  "bandwidth_limit": 1073741824,
  "bandwidth_used": 0,
  "trust_tier": "verified",
  "listing_id": listing_id,
  "order_id": order_id,
  "created_at": os.environ["NOW"],
  "expires_at": os.environ["EXP"],
  "credential_password_hash": cred_hash,
}
if os.environ.get("WITH_PROOF") == "1":
  canonical = "|".join([
    "PROXYHUB_ORDER_CREDENTIAL_V1", "1",
    order_id, session_id, buyer_id, listing_id, username_hash,
    str(issued), str(expires),
  ])
  payload_hash = hashlib.sha256(canonical.encode()).hexdigest()
  sig = hmac.new(os.environ["SESSION_SECRET"].encode(), payload_hash.encode(), hashlib.sha256).hexdigest()
  payload.update({
    "credential_proof_username_hash": username_hash,
    "credential_proof_payload_hash": payload_hash,
    "credential_proof_signature": sig,
    "credential_proof_issued_at": issued,
    "credential_proof_expires_at": expires,
  })
print(json.dumps(payload))
PY
}

connect_code() {
  python3 - <<PY
import base64, socket
user=b"$USER"; pw=b"$PW"
token=base64.b64encode(user+b":"+pw).decode()
s=socket.create_connection(("$EDGE_HOST", int("$EDGE_PORT")), timeout=10)
req=(f"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: Basic {token}\r\n\r\n").encode()
s.sendall(req)
s.settimeout(10)
data=s.recv(4096)
print(data.split(b"\r\n",1)[0].decode(errors="replace"))
open("/tmp/w5c2-connect.txt","wb").write(data)
s.close()
PY
}

echo "--- negative: marketplace session without proof ---"
sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning SETEX "session:$USER" 600 "$(build_session 0)" >/dev/null
# bust edge session cache via unique user already
NEG=$(connect_code || true)
echo "neg_connect=$NEG"
echo "$NEG" | grep -Eqi '407|Proxy Authentication' || { echo "FAIL: expected 407 without proof"; exit 2; }

echo "--- positive: marketplace session with valid proof ---"
sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning SETEX "session:$USER" 600 "$(build_session 1)" >/dev/null
# new username to avoid cache of prior reject — recreate user
USER="w5c2p-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
ORDER_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
SESSION_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
ISSUED=$(date -u +%s); EXPIRES=$((ISSUED + 7200))
sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning SETEX "session:$USER" 600 "$(build_session 1)" >/dev/null
POS=$(connect_code || true)
echo "pos_connect=$POS"
echo "$POS" | grep -Eqi 'HTTP/1\.1 200' || { echo "FAIL: expected 200 with proof"; exit 2; }

echo "W5C_CREDENTIAL_ENFORCE_OK"
echo "api=$API edge=$EDGE"
