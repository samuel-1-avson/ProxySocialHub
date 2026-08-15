#!/usr/bin/env bash
# Sprint J1 fail-closed smoke (no on-chain happy path).
# Expect: SPRINT_J1_FAILCLOSED_OK
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
API="${API:-http://127.0.0.1:8080}"
BUYER_ID="${BUYER_ID:-76609a25-0b69-4e05-9640-4c67d7a07f36}"

psqlq() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c "$1" | tr -d '\r' | head -n1; }
psqlc() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "$1"; }

FLAG=$("${COMPOSE[@]}" exec -T control-api sh -c 'printenv PROXYHUB_REQUIRE_SESSION_PDA' | tr -d '\r')
echo "flag=$FLAG"
[[ "$FLAG" == "true" ]] || { echo "PROXYHUB_REQUIRE_SESSION_PDA must be true"; exit 1; }

SECRET=$("${COMPOSE[@]}" exec -T control-api sh -c 'printenv JWT_SECRET || printenv SUPABASE_JWT_SECRET' | tr -d '\r' | head -n1)
TOKEN=$(SECRET="$SECRET" USER_ID="$BUYER_ID" python3 - <<'PY'
import os,time,hmac,hashlib,base64,json
sec=os.environ["SECRET"].encode(); uid=os.environ["USER_ID"]
b64=lambda d: base64.urlsafe_b64encode(d).rstrip(b"=").decode()
h=b64(json.dumps({"alg":"HS256","typ":"JWT"}).encode())
p=b64(json.dumps({"sub":uid,"user_id":uid,"role":"buyer","exp":int(time.time())+3600}).encode())
s=b64(hmac.new(sec,f"{h}.{p}".encode(),hashlib.sha256).digest())
print(f"{h}.{p}.{s}")
PY
)

echo "=== direct POST /v1/sessions must be gone ==="
DIRECT=$(curl -sS -o /tmp/j1-direct.json -w '%{http_code}' -X POST "$API/v1/sessions" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"rotating","bandwidth_limit":1048576}')
echo "direct_http=$DIRECT body=$(head -c 300 /tmp/j1-direct.json)"
[[ "$DIRECT" == "410" ]] || { echo "expected 410 Gone for direct session"; exit 1; }
grep -q session_pda_required /tmp/j1-direct.json

echo "=== confirm-escrow without fund/solana ==="
SID=$(psqlq "SELECT gen_random_uuid();")
# Insert pending_payment session owned by buyer (credentials encrypted by app normally — raw insert for smoke)
psqlc "INSERT INTO sessions (id, user_id, type, status, config, bandwidth_limit, created_at, start_time, end_time, bytes_used)
       VALUES ('$SID', '$BUYER_ID', 'universal', 'pending_payment', '{}', 1048576, NOW(), NOW(), NOW() + INTERVAL '1 day', 0);"

CONF=$(curl -sS -o /tmp/j1-conf.json -w '%{http_code}' -X POST "$API/v1/sessions/$SID/confirm-escrow" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}')
echo "confirm_http=$CONF body=$(head -c 400 /tmp/j1-conf.json)"
[[ "$CONF" == "400" ]] || { echo "expected 400 session_pda_required"; exit 1; }
grep -q session_pda_required /tmp/j1-conf.json

psqlc "DELETE FROM sessions WHERE id='$SID';" >/dev/null

echo "=== intent Active blocked without escrow_confirmed_at (fund-without-confirm hole) ==="
IID=$(psqlq "SELECT gen_random_uuid();")
psqlc "INSERT INTO session_intents (
  id, user_id, session_type, lifecycle_state, bandwidth_limit, expires_at, created_at, updated_at,
  session_pda, payment_method
) VALUES (
  '$IID', '$BUYER_ID', 'rotating', 'authorized', 1048576, NOW() + INTERVAL '1 day', NOW(), NOW(),
  'FakePDAForSmoke111111111111111111111111111', 'solana_session_escrow_pending'
);"

GW_SECRET=$("${COMPOSE[@]}" exec -T control-api sh -c 'printenv GATEWAY_SHARED_SECRET' | tr -d '\r')
ACTIVE=$(curl -sS -o /tmp/j1-active.json -w '%{http_code}' -X POST "$API/v1/gateway/session-intents/$IID/state" \
  -H "X-Gateway-Auth: $GW_SECRET" -H 'Content-Type: application/json' \
  -d '{"lifecycle_state":"active"}')
echo "active_http=$ACTIVE body=$(head -c 400 /tmp/j1-active.json)"
[[ "$ACTIVE" == "402" ]] || { echo "expected 402 session_escrow_required for unconfirmed intent"; exit 1; }
grep -q session_escrow_required /tmp/j1-active.json

# Even with payment_method already set to final value (legacy hole), missing confirm must 402.
psqlc "UPDATE session_intents SET payment_method='solana_session_escrow', escrow_confirmed_at=NULL WHERE id='$IID';" >/dev/null
ACTIVE2=$(curl -sS -o /tmp/j1-active2.json -w '%{http_code}' -X POST "$API/v1/gateway/session-intents/$IID/state" \
  -H "X-Gateway-Auth: $GW_SECRET" -H 'Content-Type: application/json' \
  -d '{"lifecycle_state":"active"}')
echo "active2_http=$ACTIVE2 body=$(head -c 400 /tmp/j1-active2.json)"
[[ "$ACTIVE2" == "402" ]] || { echo "expected 402 when escrow_confirmed_at null"; exit 1; }

psqlc "DELETE FROM session_intents WHERE id='$IID';" >/dev/null

echo "SPRINT_J1_FAILCLOSED_OK"
