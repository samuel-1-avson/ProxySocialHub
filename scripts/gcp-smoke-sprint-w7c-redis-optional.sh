#!/usr/bin/env bash
# Wave 7.C — Redis-optional CONNECT with a phubb1. capability password.
#
# Requires PROXYHUB_SESSION_CAPABILITY=enforce on the edge under test.
# Signs a token, does not SET Redis session:<user>, CONNECT with username + token.
#
# Optional: CONFIRM_W7C_DELETE_REDIS=1 also SET then DEL the key and CONNECT again.
set -euo pipefail
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"
EDGE_HOST="${EDGE_BUYER_HOST:-127.0.0.1}"
EDGE_PORT="${EDGE_BUYER_PORT:-18091}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== W7.C Redis-optional CONNECT ==="

MODE_API=$(sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_SESSION_CAPABILITY 2>/dev/null | tr -d '\r' || true)
MODE_EDGE=$(sudo docker exec proxyhubb-edge-gateway-b-1 printenv PROXYHUB_SESSION_CAPABILITY 2>/dev/null | tr -d '\r' || true)
echo "control_api_mode=${MODE_API:-unset} edge_b_mode=${MODE_EDGE:-unset}"

HONESTY=$(curl -fsS "$API/v1/system/config/public" | python3 -c 'import json,sys; d=json.load(sys.stdin); c=d.get("session_capability") or {}; print("session_mint="+str(c.get("session_mint"))+" redis_optional="+str(c.get("redis_optional_connect"))+" remaining_spof="+str(c.get("remaining_spof")))' || true)
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

USER="w7c-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
SESSION_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
BUYER_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
LISTING_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
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
TOKEN=$(echo "$CAP_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
echo "signed_issuer=$(echo "$CAP_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["issuer_pubkey"])')"
echo "$TOKEN" | grep -q '^phubb1\.' || { echo "FAIL: signer did not emit phubb1. token"; exit 2; }

# Do not write session:<user>. Delete if a leftover exists.
sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning DEL "session:$USER" >/dev/null || true
EXISTS=$(sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning EXISTS "session:$USER" | tr -d '\r')
echo "redis_session_exists=$EXISTS"
[[ "$EXISTS" == "0" ]] || { echo "FAIL: Redis session: key still present"; exit 2; }

connect_code() {
  local user="$1"
  local pw="$2"
  python3 - <<PY
import base64, socket
user=b"""$user"""; pw=b"""$pw"""
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

echo "--- negative: no token, no Redis ---"
NEG=$(connect_code "$USER" "legacy-not-a-token" || true)
echo "neg_connect=$NEG"
echo "$NEG" | grep -Eqi '407|Proxy Authentication' || { echo "FAIL: expected 407 without token"; exit 2; }

echo "--- negative: garbage phubb1. prefix (no Redis fallback) ---"
GARBAGE=$(connect_code "$USER" "phubb1.not-a-valid-token" || true)
echo "garbage_connect=$GARBAGE"
echo "$GARBAGE" | grep -Eqi '407|Proxy Authentication' || { echo "FAIL: expected 407 for invalid phubb1. token"; exit 2; }

echo "--- positive: token CONNECT with Redis session: missing ---"
POS=$(connect_code "$USER" "$TOKEN" || true)
echo "pos_connect=$POS"
echo "$POS" | grep -Eqi 'HTTP/1\.1 200' || { echo "FAIL: expected 200 with capability token and no Redis session:"; exit 2; }

echo "W7C_REDIS_OPTIONAL_CONNECT_OK"

if [[ "${CONFIRM_W7C_DELETE_REDIS:-}" == "1" ]]; then
  echo "--- soak: SET then DEL Redis key, CONNECT with token ---"
  sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning SETEX "session:$USER" 60 '{"user_id":"x","session_id":"y","type":"sticky","status":"active","bandwidth_limit":1,"bandwidth_used":0}' >/dev/null
  sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning DEL "session:$USER" >/dev/null
  DEL=$(connect_code "$USER" "$TOKEN" || true)
  echo "after_del_connect=$DEL"
  echo "$DEL" | grep -Eqi 'HTTP/1\.1 200' || { echo "FAIL: expected 200 after Redis DEL"; exit 2; }
  echo "W7C_REDIS_DELETE_CONNECT_OK"
else
  echo "W7C_REDIS_DELETE_CONNECT_SKIPPED (set CONFIRM_W7C_DELETE_REDIS=1)"
fi

echo "api=$API edge=${EDGE_HOST}:${EDGE_PORT} remaining_spof=token_issuer"
