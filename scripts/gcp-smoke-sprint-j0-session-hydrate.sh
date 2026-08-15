#!/usr/bin/env bash
# Sprint J0 smoke: session dual-write + hydrate after Redis key delete.
# Expect: SPRINT_J0_SESSION_HYDRATE_OK
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

API="${API:-http://127.0.0.1:8080}"
psqlq() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c "$1" | tr -d '\r' | head -n1; }
psqlc() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "$1"; }

REDIS_PASS=$("${COMPOSE[@]}" exec -T redis sh -c 'printenv REDIS_PASSWORD' 2>/dev/null | tr -d '\r' || true)
if [[ -z "$REDIS_PASS" ]]; then
  REDIS_PASS=$(grep -E '^REDIS_PASSWORD=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
fi
redis() {
  if [[ -n "${REDIS_PASS:-}" ]]; then
    "${COMPOSE[@]}" exec -T redis redis-cli -a "$REDIS_PASS" --no-auth-warning "$@"
  else
    "${COMPOSE[@]}" exec -T redis redis-cli "$@"
  fi
}

echo "=== J0: ensure migration 000141 ==="
REG=$(psqlq "SELECT to_regclass('public.session_gateway_cache');")
if [[ "$REG" != "session_gateway_cache" ]]; then
  echo "applying 000141..."
  sudo docker exec -i proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb \
    < migrations/000141_session_gateway_cache.up.sql
fi
psqlq "SELECT to_regclass('public.session_gateway_cache');" | grep -q session_gateway_cache

SECRET=$("${COMPOSE[@]}" exec -T control-api sh -c 'printenv GATEWAY_SHARED_SECRET' | tr -d '\r')
[[ -n "$SECRET" ]] || { echo "GATEWAY_SHARED_SECRET empty"; exit 1; }

USER="j0$(openssl rand -hex 3)"
PASS="p$(openssl rand -hex 8)"
SID=$(psqlq "SELECT gen_random_uuid();")
BUYER_UID=$(psqlq "SELECT gen_random_uuid();")

PASS_HASH=$(printf '%s' "$PASS" | sha256sum | awk '{print $1}')
USER_HASH=$(printf '%s' "$USER" | sha256sum | awk '{print $1}')
PAYLOAD=$(python3 - <<PY
import json
print(json.dumps({
  "user_id": "$BUYER_UID",
  "session_id": "$SID",
  "provider_id": "",
  "type": "rotating",
  "status": "active",
  "bandwidth_limit": 104857600,
  "bandwidth_used": 0,
  "trust_tier": "standard",
  "credential_password_hash": "$PASS_HASH",
}))
PY
)

echo "=== seed Redis + PG cache user=$USER ==="
PAYLOAD_SQL=${PAYLOAD//\'/\'\'}
psqlc "INSERT INTO session_gateway_cache (credentials_user_hash, session_id, payload, expires_at, updated_at)
       VALUES ('$USER_HASH', '$SID', '$PAYLOAD_SQL'::jsonb, NOW() + INTERVAL '24 hours', NOW())
       ON CONFLICT (credentials_user_hash) DO UPDATE
       SET session_id=EXCLUDED.session_id, payload=EXCLUDED.payload,
           expires_at=EXCLUDED.expires_at, updated_at=EXCLUDED.updated_at;"

redis SET "session:$USER" "$PAYLOAD" EX 3600 >/dev/null
EXISTS_BEFORE=$(redis EXISTS "session:$USER" | tr -d '\r')
[[ "$EXISTS_BEFORE" == "1" ]] || { echo "redis seed failed exists=$EXISTS_BEFORE"; exit 1; }

echo "=== delete Redis key (simulate eviction) ==="
redis DEL "session:$USER" >/dev/null
EXISTS_MID=$(redis EXISTS "session:$USER" | tr -d '\r')
[[ "$EXISTS_MID" == "0" ]] || { echo "redis del failed"; exit 1; }

echo "=== hydrate via control-api ==="
HTTP=$(curl -sS -o /tmp/j0-hydrate.json -w '%{http_code}' \
  -H "X-Gateway-Auth: $SECRET" \
  "$API/v1/gateway/sessions/hydrate?username=$USER")
echo "hydrate_http=$HTTP"
cat /tmp/j0-hydrate.json
echo
[[ "$HTTP" == "200" ]] || { echo "hydrate failed"; exit 1; }
grep -q session_gateway_cache /tmp/j0-hydrate.json
grep -q "$SID" /tmp/j0-hydrate.json

echo "=== Redis rewarmed? ==="
EXISTS_AFTER=$(redis EXISTS "session:$USER" | tr -d '\r')
[[ "$EXISTS_AFTER" == "1" ]] || { echo "redis not rewarmed"; exit 1; }

echo "=== second hydrate after another Redis delete ==="
redis DEL "session:$USER" >/dev/null
HTTP2=$(curl -sS -o /tmp/j0-hydrate2.json -w '%{http_code}' \
  -H "X-Gateway-Auth: $SECRET" \
  "$API/v1/gateway/sessions/hydrate?username=$USER")
[[ "$HTTP2" == "200" ]] || { echo "second hydrate failed http=$HTTP2"; exit 1; }

psqlc "DELETE FROM session_gateway_cache WHERE credentials_user_hash='$USER_HASH';" >/dev/null
redis DEL "session:$USER" >/dev/null || true

echo "SPRINT_J0_SESSION_HYDRATE_OK"
