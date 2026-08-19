#!/usr/bin/env bash
# W10.A kill-API CONNECT on the *current* Host-A control-api image.
# docker stop / docker start — not compose recreate (keeps observe + GATEWAY_OP_*).
# HMAC still admits in observe. Redis still required. Never --remove-orphans.
#
#   CONFIRM_W10A_KILL_API=1 bash /tmp/gcp-host-a-w10a-kill-api.sh
set -euo pipefail
if [[ "${CONFIRM_W10A_KILL_API:-}" != "1" ]]; then
  echo "REFUSE: set CONFIRM_W10A_KILL_API=1 on Host-A"
  exit 2
fi
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"
EDGE_HOST="${EDGE_BUYER_HOST:-127.0.0.1}"
EDGE_PORT="${EDGE_BUYER_PORT:-18091}"
CTR=proxyhubb-control-api-1

restore() { sudo docker start "$CTR" >/dev/null 2>&1 || true; }
trap restore EXIT

wait_ctr() {
  local name="$1" i st
  for i in $(seq 1 40); do
    st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name" 2>/dev/null || echo missing)
    if [[ "$st" == "healthy" ]]; then
      echo "$name healthy"
      return 0
    fi
    echo "wait $name try=$i st=$st"
    sleep 3
  done
  echo "FAIL: $name not healthy"
  return 1
}

echo "=== W10.A kill-API CONNECT (current image) ==="
cap=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY 2>/dev/null || echo unset)
[[ "$cap" == "observe" ]] || { echo "FAIL: capability is '$cap' not observe"; exit 2; }
slash_auto=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
slash_confirm=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
if [[ -n "${slash_auto:-}" || -n "${slash_confirm:-}" ]]; then
  echo "FAIL: slash dual-gate is set"
  exit 2
fi

SESSION_SECRET=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv SESSION_SECRET | tr -d '\r')
REDIS_URL=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv REDIS_URL | tr -d '\r')
REDIS_HOST=$(U="$REDIS_URL" python3 -c 'import os,urllib.parse; print(urllib.parse.urlparse(os.environ["U"]).hostname or "")')
REDIS_CTR=proxyhubb-redis-1
[[ "$REDIS_HOST" == "redis-replica" ]] && REDIS_CTR=proxyhubb-redis-replica-1
PASS=$(U="$REDIS_URL" python3 -c 'import os,urllib.parse; print(urllib.parse.urlparse(os.environ["U"]).password or "")')
USER="w10a-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
PW="w10a-pass-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
python3 - "$USER" "$PW" "$SESSION_SECRET" <<'PY' > /tmp/w10a-session.json
import hashlib, hmac, json, sys, time, uuid
user, pw, secret = sys.argv[1], sys.argv[2], sys.argv[3]
order_id=str(uuid.uuid4()); session_id=str(uuid.uuid4()); buyer_id=str(uuid.uuid4()); listing_id=str(uuid.uuid4())
issued=int(time.time()); expires=issued+7200
uh=hashlib.sha256(user.encode()).hexdigest()
canonical="|".join([
  "PROXYHUB_ORDER_CREDENTIAL_V1","1",order_id,session_id,buyer_id,listing_id,uh,str(issued),str(expires)
])
payload=hashlib.sha256(canonical.encode()).hexdigest()
sig=hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
now=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
exp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expires))
print(json.dumps({
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
  "created_at": now,
  "expires_at": exp,
  "credential_password_hash": hashlib.sha256(pw.encode()).hexdigest(),
  "credential_proof_username_hash": uh,
  "credential_proof_payload_hash": payload,
  "credential_proof_signature": sig,
  "credential_proof_issued_at": issued,
  "credential_proof_expires_at": expires,
}))
PY
sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning SETEX "session:$USER" 600 "$(cat /tmp/w10a-session.json)" >/dev/null

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
s.close()
PY
}

UP=$(connect_code || true)
echo "api_up_connect=$UP"
echo "$UP" | grep -Eqi 'HTTP/1\.1 200' || { echo "FAIL: expected 200 before API stop"; exit 2; }

sudo docker stop "$CTR" >/dev/null
sleep 2
if curl -fsS --max-time 2 "$API/v1/system/config/public" >/dev/null 2>&1; then
  echo "FAIL: control-api still reachable after stop"
  exit 2
fi
DOWN=$(connect_code || true)
echo "api_down_connect=$DOWN"

restore
trap - EXIT
wait_ctr "$CTR"
hid_a=$(sudo docker exec "$CTR" printenv GATEWAY_OP_A_HOST_ID)
hid_b=$(sudo docker exec "$CTR" printenv GATEWAY_OP_B_HOST_ID)
cap2=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY)
echo "PROXYHUB_SESSION_CAPABILITY=$cap2"
echo "GATEWAY_OP_A_HOST_ID=$hid_a"
echo "GATEWAY_OP_B_HOST_ID=$hid_b"
[[ "$cap2" == "observe" ]] || { echo "FAIL: capability flipped to $cap2"; exit 2; }
[[ "$hid_a" == "gce-proxyhubb-testnet" ]] || { echo "FAIL: GATEWAY_OP_A_HOST_ID=$hid_a"; exit 2; }
[[ "$hid_b" == "gce-w6-operator-b" ]] || { echo "FAIL: GATEWAY_OP_B_HOST_ID=$hid_b"; exit 2; }
echo "$DOWN" | grep -Eqi 'HTTP/1\.1 200' || { echo "FAIL: expected 200 with API down"; exit 2; }
rm -f /tmp/w10a-session.json
echo "W10A_KILL_API_CONNECT_OK"
echo "image still observe; redis required; not enforce; not DePIN"
