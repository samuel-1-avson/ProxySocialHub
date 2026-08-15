#!/usr/bin/env bash
# Sprint H EV-05 lite smoke: inject spill ??? wait for drain ??? usage_receipts.
set -euo pipefail
cd /opt/proxyhubb

DC=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

SESSION="sprint-h-spill-$(date -u +%s)"
SESSION_ID="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)"
SECRET="$("${DC[@]}" exec -T control-api printenv GATEWAY_SHARED_SECRET | tr -d '\r')"
REDIS_URL="$("${DC[@]}" exec -T control-api printenv REDIS_URL | tr -d '\r')"
test -n "$SECRET"
test -n "$REDIS_URL"

SESSION_JSON=$(printf '{"user_id":"00000000-0000-0000-0000-000000000001","session_id":"%s","provider_id":"","type":"sticky","status":"active","bandwidth_limit":0,"price_per_gb":0.01}' "$SESSION_ID")

# redis://:password@host:6379 ??? password between : and @
REDIS_PASS="${REDIS_URL#*://}"
REDIS_PASS="${REDIS_PASS#*:}"
REDIS_PASS="${REDIS_PASS%@*}"
# If URL had no password, REDIS_PASS equals host:port fragment ??? detect by '@' presence.
if [[ "$REDIS_URL" != *"@"* ]]; then
  REDIS_PASS=""
fi

if [ -n "$REDIS_PASS" ]; then
  echo "redis_auth=yes"
  sudo docker exec proxyhubb-redis-1 redis-cli -a "$REDIS_PASS" --no-auth-warning SET "session:${SESSION}" "$SESSION_JSON" EX 3600 >/dev/null
  got=$(sudo docker exec proxyhubb-redis-1 redis-cli -a "$REDIS_PASS" --no-auth-warning EXISTS "session:${SESSION}" | tr -d '[:space:]')
else
  echo "redis_auth=no"
  sudo docker exec proxyhubb-redis-1 redis-cli SET "session:${SESSION}" "$SESSION_JSON" EX 3600 >/dev/null
  got=$(sudo docker exec proxyhubb-redis-1 redis-cli EXISTS "session:${SESSION}" | tr -d '[:space:]')
fi
echo "redis_session_exists=$got"
test "$got" = "1"

HTTP_CODE=$(sudo docker run --rm --network proxyhubb_backend curlimages/curl:8.5.0 -sS -o /dev/null -w "%{http_code}" \
  -X POST "http://control-api:8080/v1/gateway/metering/spill" \
  -H "Content-Type: application/json" \
  -H "X-Gateway-Auth: ${SECRET}" \
  -d "{\"session_username\":\"${SESSION}\",\"bytes_up\":111,\"bytes_down\":222,\"source\":\"sprint_h_smoke\"}")
echo "spill_http=$HTTP_CODE session=$SESSION"
test "$HTTP_CODE" = "202" -o "$HTTP_CODE" = "200"

ok=0
for i in $(seq 1 24); do
  status=$("${DC[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -tAc \
    "SELECT status FROM metering_wal_spill WHERE session_username='${SESSION}' AND bytes_up=111 ORDER BY created_at DESC LIMIT 1;" | tr -d '[:space:]' || true)
  echo "attempt=$i spill_status=${status:-none}"
  if [ "$status" = "drained" ]; then
    ok=1
    break
  fi
  if [ "$status" = "failed" ]; then
    "${DC[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
      "SELECT id,status,error FROM metering_wal_spill WHERE session_username='${SESSION}' ORDER BY created_at DESC LIMIT 3;"
    exit 1
  fi
  sleep 5
done

test "$ok" = "1"

receipts=$("${DC[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -tAc \
  "SELECT COUNT(*) FROM usage_receipts WHERE session_username='${SESSION}' AND source='metering_spill';" | tr -d '[:space:]')
echo "receipts=$receipts"
test "${receipts}" -ge 1

echo "SPRINT_H_SPILL_OK"
