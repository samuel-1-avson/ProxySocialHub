#!/usr/bin/env bash
# GW-08 Testnet smoke: seq durability markers + spill drain + receipt uniqueness.
# Exit 0 prints GW08_METERING_PASS
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
TS=$(date -u +%Y%m%dT%H%M%SZ)
SESSION="gw08-spill-${TS}"
SESSION_ID="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)"
SEQ_USER="gw08-seq-${TS}"

echo "=== GW-08 inventory (${TS}) ==="
docker inspect proxyhubb-edge-gateway-1 --format 'edge_image={{.Config.Image}} created={{.Created}}' 2>/dev/null || true
docker logs proxyhubb-control-api-1 2>&1 | grep -i 'Metering Spill Drain Worker started' | tail -2 || true

SECRET=$("${COMPOSE[@]}" exec -T control-api printenv GATEWAY_SHARED_SECRET | tr -d '\r')
REDIS_URL=$("${COMPOSE[@]}" exec -T control-api printenv REDIS_URL | tr -d '\r')
test -n "$SECRET"
test -n "$REDIS_URL"

REDIS_PASS="${REDIS_URL#*://}"
REDIS_PASS="${REDIS_PASS#*:}"
REDIS_PASS="${REDIS_PASS%@*}"
if [[ "$REDIS_URL" != *"@"* ]]; then
  REDIS_PASS=""
fi

redis_cli() {
  if [[ -n "$REDIS_PASS" ]]; then
    sudo docker exec proxyhubb-redis-1 redis-cli -a "$REDIS_PASS" --no-auth-warning "$@"
  else
    sudo docker exec proxyhubb-redis-1 redis-cli "$@"
  fi
}

echo '=== 1) Redis seq monotonic (exactly-once nonce allocator) ==='
a=$(redis_cli INCR "metering:seq:${SEQ_USER}" | tr -d '[:space:]')
b=$(redis_cli INCR "metering:seq:${SEQ_USER}" | tr -d '[:space:]')
redis_cli EXPIRE "metering:seq:${SEQ_USER}" 600 >/dev/null
echo "seq_a=$a seq_b=$b"
test "$b" = "$((a + 1))"

echo '=== 2) Pending snapshot roundtrip (crash-replay durable shape) ==='
redis_cli HSET "metering:pending:${SEQ_USER}" seq "$a" bytes_up 100 bytes_down 200 >/dev/null
redis_cli EXPIRE "metering:pending:${SEQ_USER}" 600 >/dev/null
got_seq=$(redis_cli HGET "metering:pending:${SEQ_USER}" seq | tr -d '[:space:]')
got_up=$(redis_cli HGET "metering:pending:${SEQ_USER}" bytes_up | tr -d '[:space:]')
echo "pending_seq=$got_seq pending_up=$got_up"
test "$got_seq" = "$a"
test "$got_up" = "100"
redis_cli DEL "metering:pending:${SEQ_USER}" "metering:seq:${SEQ_USER}" >/dev/null

echo '=== 3) Spill → drain → usage_receipts (Redis-fail durability path) ==='
SESSION_JSON=$(printf '{"user_id":"00000000-0000-0000-0000-000000000001","session_id":"%s","provider_id":"","type":"sticky","status":"active","bandwidth_limit":0,"price_per_gb":0.01}' "$SESSION_ID")
redis_cli SET "session:${SESSION}" "$SESSION_JSON" EX 3600 >/dev/null
test "$(redis_cli EXISTS "session:${SESSION}" | tr -d '[:space:]')" = "1"

HTTP_CODE=$(sudo docker run --rm --network proxyhubb_backend curlimages/curl:8.5.0 -sS -o /tmp/spill.out -w "%{http_code}" \
  -X POST "http://control-api:8080/v1/gateway/metering/spill" \
  -H "Content-Type: application/json" \
  -H "X-Gateway-Auth: ${SECRET}" \
  -d "{\"session_username\":\"${SESSION}\",\"bytes_up\":333,\"bytes_down\":444,\"source\":\"gw08_smoke\"}")
echo "spill_http=$HTTP_CODE session=$SESSION"
test "$HTTP_CODE" = "202" -o "$HTTP_CODE" = "200"

ok=0
for i in $(seq 1 30); do
  status=$("${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -tAc \
    "SELECT status FROM metering_wal_spill WHERE session_username='${SESSION}' AND bytes_up=333 ORDER BY created_at DESC LIMIT 1;" | tr -d '[:space:]' || true)
  echo "attempt=$i spill_status=${status:-none}"
  if [[ "$status" == "drained" ]]; then
    ok=1
    break
  fi
  if [[ "$status" == "failed" ]]; then
    "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
      "SELECT id,status,error FROM metering_wal_spill WHERE session_username='${SESSION}' ORDER BY created_at DESC LIMIT 3;"
    exit 1
  fi
  sleep 4
done
test "$ok" = "1"

receipts=$("${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -tAc \
  "SELECT COUNT(*) FROM usage_receipts WHERE session_username='${SESSION}' AND source='metering_spill';" | tr -d '[:space:]')
echo "receipts=$receipts"
test "${receipts}" -ge 1

echo '=== 4) UNIQUE(session_username, nonce) blocks double-charge ==='
nonce=$("${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -tAc \
  "SELECT nonce FROM usage_receipts WHERE session_username='${SESSION}' AND source='metering_spill' ORDER BY created_at DESC LIMIT 1;" | tr -d '[:space:]')
echo "nonce=$nonce"
set +e
dup_out=$("${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 -c \
  "INSERT INTO usage_receipts (
      id, session_id, session_username, bytes_up, bytes_down, total_bytes,
      nonce, signature, source, status, reported_at, created_at, updated_at
   )
   SELECT gen_random_uuid(), session_id, session_username, bytes_up, bytes_down, total_bytes,
          nonce, 'dup-test', 'gw08_dup', status, now(), now(), now()
   FROM usage_receipts WHERE session_username='${SESSION}' AND nonce=${nonce} LIMIT 1;" 2>&1)
dup_rc=$?
set -e
echo "dup_insert_rc=$dup_rc"
echo "$dup_out" | tail -5
test "$dup_rc" -ne 0
echo "$dup_out" | grep -qiE 'unique|duplicate' || {
  echo 'DUP_INSERT_FAILED_FOR_WRONG_REASON'
  exit 1
}

echo '=== 5) Live seq key presence (edge has been allocating nonces) ==='
seq_count=$(redis_cli KEYS 'metering:seq:*' | wc -l | tr -d '[:space:]')
echo "live_seq_keys=$seq_count"
test "$seq_count" -ge 1

echo GW08_METERING_PASS
