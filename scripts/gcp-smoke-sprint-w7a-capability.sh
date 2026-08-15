#!/usr/bin/env bash
# Wave 7.A — Ed25519 session capability on CONNECT (no control-api at verify).
#
# Default: inject a signed capability into Redis and CONNECT (HMAC not required
# when PROXYHUB_SESSION_CAPABILITY=enforce).
#
# Optional soak (stops control-api briefly):
#   CONFIRM_W7A_STOP_API=1 ./scripts/gcp-smoke-sprint-w7a-capability.sh
set -euo pipefail
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"
EDGE_HOST="${EDGE_BUYER_HOST:-127.0.0.1}"
EDGE_PORT="${EDGE_BUYER_PORT:-18091}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== W7.A session capability ==="

MODE_API=$(sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_SESSION_CAPABILITY 2>/dev/null | tr -d '\r' || true)
MODE_EDGE=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv PROXYHUB_SESSION_CAPABILITY 2>/dev/null | tr -d '\r' || true)
echo "control_api_mode=${MODE_API:-unset} edge_b_mode=${MODE_EDGE:-unset}"

HONESTY=$(curl -fsS "$API/v1/system/config/public" | python3 -c 'import json,sys; d=json.load(sys.stdin); c=d.get("session_capability") or {}; print("session_mint="+str(c.get("session_mint"))+" mode="+str(c.get("session_capability_mode"))+" issuer="+str(c.get("session_capability_issuer")))' || true)
echo "honesty=$HONESTY"

if [[ "${MODE_EDGE:-off}" != "enforce" ]]; then
  echo "FAIL: edge PROXYHUB_SESSION_CAPABILITY must be enforce for this soak (got ${MODE_EDGE:-unset})"
  exit 2
fi

SIGNING_KEY=$(sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY | tr -d '\r')
ISSUER=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY | tr -d '\r' | cut -d, -f1)
[[ -n "$SIGNING_KEY" ]] || { echo "FAIL: PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY empty on control-api"; exit 2; }
[[ -n "$ISSUER" ]] || { echo "FAIL: PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY empty on edge-b"; exit 2; }

PASS=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv REDIS_URL | sed -n 's|redis://:\([^@]*\)@.*|\1|p' | tr -d '\r')
REDIS_HOST=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv REDIS_URL | sed -n 's|redis://:[^@]*@\([^:]*\):.*|\1|p' | tr -d '\r')
REDIS_CTR=proxyhubb-redis-1
[[ "$REDIS_HOST" == "redis-replica" ]] && REDIS_CTR=proxyhubb-redis-replica-1

USER="w7a-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
PW="w7a-pass-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
ORDER_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
SESSION_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
BUYER_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
LISTING_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EXP=$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ)
ISSUED=$(date -u +%s)
EXPIRES=$((ISSUED + 7200))
BW=1073741824

sign_cap() {
  SIGNING_KEY="$SIGNING_KEY" SESSION_ID="$SESSION_ID" OFFER="$LISTING_ID" BUYER_ID="$BUYER_ID" \
  EXPIRES="$EXPIRES" BW="$BW" USER="$USER" ISSUED="$ISSUED" python3 - <<'PY' | sign_stdin
import json, os
print(json.dumps({
  "signing_key": os.environ["SIGNING_KEY"],
  "session_id": os.environ["SESSION_ID"],
  "offer_hash": os.environ["OFFER"],
  "buyer_id": os.environ["BUYER_ID"],
  "expires_at": int(os.environ["EXPIRES"]),
  "bandwidth_limit": int(os.environ["BW"]),
  "username": os.environ["USER"],
  "issued_at": int(os.environ["ISSUED"]),
}))
PY
}

sign_stdin() {
  if [[ -x "${W7A_SIGN_BIN:-}" ]]; then
    "$W7A_SIGN_BIN"
  else
    (cd "$ROOT/services/control-api" && go run ./cmd/w7a-capability-sign)
  fi
}

CAP_JSON=$(sign_cap)
echo "signed_issuer=$(echo "$CAP_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["issuer_pubkey"])')"

build_session() {
  local with_cap="$1"
  USER="$USER" PW="$PW" ORDER_ID="$ORDER_ID" SESSION_ID="$SESSION_ID" \
  BUYER_ID="$BUYER_ID" LISTING_ID="$LISTING_ID" NOW="$NOW" EXP="$EXP" \
  BW="$BW" WITH_CAP="$with_cap" CAP_JSON="$CAP_JSON" python3 - <<'PY'
import hashlib, json, os
user = os.environ["USER"]
pw = os.environ["PW"]
payload = {
  "user_id": os.environ["BUYER_ID"],
  "session_id": os.environ["SESSION_ID"],
  "provider_id": "",
  "type": "sticky",
  "status": "active",
  "bandwidth_limit": int(os.environ["BW"]),
  "bandwidth_used": 0,
  "trust_tier": "verified",
  "listing_id": os.environ["LISTING_ID"],
  "order_id": os.environ["ORDER_ID"],
  "created_at": os.environ["NOW"],
  "expires_at": os.environ["EXP"],
  "credential_password_hash": hashlib.sha256(pw.encode()).hexdigest(),
}
if os.environ.get("WITH_CAP") == "1":
  cap = json.loads(os.environ["CAP_JSON"])
  payload.update({
    "capability_version": "1",
    "capability_offer_hash": os.environ["LISTING_ID"],
    "capability_buyer_id": os.environ["BUYER_ID"],
    "capability_expires_at": cap["expires_at"],
    "capability_bandwidth_limit": int(os.environ["BW"]),
    "capability_operator_pubkey": cap["operator_pubkey"],
    "capability_username_hash": cap["username_hash"],
    "capability_issued_at": cap["issued_at"],
    "capability_signature": cap["signature"],
    "capability_issuer_pubkey": cap["issuer_pubkey"],
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
s.close()
PY
}

echo "--- negative: marketplace session without capability ---"
sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning SETEX "session:$USER" 600 "$(build_session 0)" >/dev/null
NEG=$(connect_code || true)
echo "neg_connect=$NEG"
echo "$NEG" | grep -Eqi '407|Proxy Authentication' || { echo "FAIL: expected 407 without capability"; exit 2; }

echo "--- positive: marketplace session with capability (HMAC omitted) ---"
USER="w7ap-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
SESSION_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
ISSUED=$(date -u +%s); EXPIRES=$((ISSUED + 7200))
CAP_JSON=$(sign_cap)
sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning SETEX "session:$USER" 600 "$(build_session 1)" >/dev/null
POS=$(connect_code || true)
echo "pos_connect=$POS"
echo "$POS" | grep -Eqi 'HTTP/1\.1 200' || { echo "FAIL: expected 200 with capability"; exit 2; }

echo "W7A_CAPABILITY_CONNECT_OK"

if [[ "${CONFIRM_W7A_STOP_API:-}" == "1" ]]; then
  echo "--- soak: stop control-api, CONNECT again ---"
  sudo docker stop proxyhubb-control-api-1 >/dev/null
  sleep 2
  if curl -fsS --max-time 2 "$API/v1/system/config/public" >/dev/null 2>&1; then
    sudo docker start proxyhubb-control-api-1 >/dev/null || true
    echo "FAIL: control-api still reachable after stop"
    exit 2
  fi
  DOWN=$(connect_code || true)
  echo "api_down_connect=$DOWN"
  sudo docker start proxyhubb-control-api-1 >/dev/null
  echo "$DOWN" | grep -Eqi 'HTTP/1\.1 200' || { echo "FAIL: expected 200 with API down"; exit 2; }
  echo "W7A_API_DOWN_CONNECT_OK"
else
  echo "W7A_API_DOWN_CONNECT_SKIPPED (set CONFIRM_W7A_STOP_API=1)"
fi

echo "api=$API edge=${EDGE_HOST}:${EDGE_PORT}"
