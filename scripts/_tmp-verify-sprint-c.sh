#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

"${COMPOSE[@]}" up -d --no-deps web
# ensure control-api is up too
"${COMPOSE[@]}" up -d --no-deps control-api

for i in $(seq 1 48); do
  api=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' 2>/dev/null || true)
  web=$("${COMPOSE[@]}" ps web --format '{{.Status}}' 2>/dev/null || true)
  echo "try=$i api=$api web=$web"
  if echo "$api" | grep -qi healthy && echo "$web" | grep -qi healthy; then
    echo BOTH_HEALTHY
    break
  fi
  sleep 5
done

echo "=== 000139 ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT version FROM schema_migrations WHERE version LIKE '%000139%';"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='compensation_outbox' AND column_name='metadata';"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='compensation_outbox'::regclass AND contype='c';"

echo "=== SESSION_PROGRAM_ID ==="
sid=$("${COMPOSE[@]}" exec -T control-api printenv SESSION_PROGRAM_ID 2>/dev/null | tr -d '\r' || true)
if [[ -n "${sid:-}" ]]; then
  echo "FAIL SESSION_PROGRAM_ID=$sid"
  exit 1
fi
echo SESSION_PROGRAM_UNSET_OK

echo "=== health ==="
curl -sS -o /dev/null -w "api=%{http_code}\n" http://127.0.0.1:18080/health
curl -sS -o /dev/null -w "web=%{http_code}\n" http://127.0.0.1:3000/

echo "=== p2p_settle kind smoke (schema only) ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "INSERT INTO compensation_outbox (id, kind, user_id, amount_sol, reference_id, metadata, status, next_retry_at)
   SELECT gen_random_uuid(), 'p2p_settle', id, 0.001, 'sprint-c-schema-smoke-' || gen_random_uuid()::text, '{\"sender_wallet\":\"x\"}'::jsonb, 'pending', NOW()
   FROM profiles LIMIT 1
   RETURNING kind, status;"
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "DELETE FROM compensation_outbox WHERE reference_id LIKE 'sprint-c-schema-smoke-%';"

echo SPRINT_C_VERIFY_OK
