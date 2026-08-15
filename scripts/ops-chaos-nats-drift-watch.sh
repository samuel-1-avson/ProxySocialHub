#!/usr/bin/env bash
# Post-roll ops: chaos Redis HA-lite + sample NATS lag gauges + journal drift alerts.
# Run on proxyhubb-testnet VM from /opt/proxyhubb.
set -euo pipefail
cd /opt/proxyhubb

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== status ==="
"${COMPOSE[@]}" ps control-api edge-gateway redis --format 'table {{.Name}}\t{{.Status}}'

echo "=== nats gauges (pre) ==="
curl -fsS http://127.0.0.1:8080/metrics \
  | grep -E '^nats_(consumer_num_pending|consumer_num_ack_pending|stream_messages|stream_bytes|lag_scrape_errors)' \
  | head -40 || echo NONE

echo "=== scraper / recon log (15m) ==="
"${COMPOSE[@]}" logs control-api --since 15m 2>/dev/null \
  | grep -E 'NATS consumer lag|JOURNAL|Per-Wallet Drift|Journal Liability|reconciliation' \
  | tail -40 || true

echo "=== seed session for chaos ==="
SECRET=$("${COMPOSE[@]}" exec -T control-api sh -c 'printenv GATEWAY_SHARED_SECRET' | tr -d '\r')
[[ -n "$SECRET" ]] || { echo "GATEWAY_SHARED_SECRET empty"; exit 1; }

REDIS_PASS=$("${COMPOSE[@]}" exec -T redis sh -c 'printenv REDIS_PASSWORD' 2>/dev/null | tr -d '\r' || true)
if [[ -z "${REDIS_PASS:-}" ]]; then
  REDIS_PASS=$(grep -E '^REDIS_PASSWORD=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)
fi

redis() {
  if [[ -n "${REDIS_PASS:-}" ]]; then
    "${COMPOSE[@]}" exec -T redis redis-cli -a "$REDIS_PASS" --no-auth-warning "$@"
  else
    "${COMPOSE[@]}" exec -T redis redis-cli "$@"
  fi
}

psqlq() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c "$1" | tr -d '\r' | head -n1; }
psqlc() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "$1"; }

USER="chaos$(openssl rand -hex 3)"
PASS_HASH=$(printf '%s' "p$(openssl rand -hex 4)" | sha256sum | awk '{print $1}')
SID=$(psqlq "SELECT gen_random_uuid();")
BUYER=$(psqlq "SELECT gen_random_uuid();")
USER_HASH=$(printf '%s' "$USER" | sha256sum | awk '{print $1}')
PAYLOAD=$(python3 - <<PY
import json
print(json.dumps({
  "user_id": "$BUYER",
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
PAYLOAD_SQL=${PAYLOAD//\'/\'\'}
psqlc "INSERT INTO session_gateway_cache (credentials_user_hash, session_id, payload, expires_at, updated_at)
       VALUES ('$USER_HASH', '$SID', '$PAYLOAD_SQL'::jsonb, NOW() + INTERVAL '24 hours', NOW())
       ON CONFLICT (credentials_user_hash) DO UPDATE
       SET session_id=EXCLUDED.session_id, payload=EXCLUDED.payload,
           expires_at=EXCLUDED.expires_at, updated_at=EXCLUDED.updated_at;" >/dev/null
redis SET "session:$USER" "$PAYLOAD" EX 3600 >/dev/null
echo "SESSION_USER=$USER"

export COMPOSE_FILES="-f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml"
export GATEWAY_SHARED_SECRET="$SECRET"
export REDIS_PASSWORD="${REDIS_PASS:-}"
export SESSION_USER="$USER"
export GATEWAY_HOST=127.0.0.1
export GATEWAY_PORT=8090
export API_BASE=http://127.0.0.1:8080

bash ./scripts/chaos-redis-ha-lite.sh

echo "=== post-chaos health ==="
curl -fsS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health
curl -fsS -o /dev/null -w "edge_health=%{http_code}\n" http://127.0.0.1:8090/health
"${COMPOSE[@]}" ps control-api edge-gateway redis --format 'table {{.Name}}\t{{.Status}}'

echo "=== nats gauges (post, wait one scraper tick) ==="
sleep 35
curl -fsS http://127.0.0.1:8080/metrics \
  | grep -E '^nats_(consumer_num_pending|consumer_num_ack_pending|stream_messages|stream_bytes|lag_scrape_errors)' \
  | head -40 || echo NONE

echo "=== drift / lag alert sample (2h) ==="
"${COMPOSE[@]}" logs control-api --since 2h 2>/dev/null \
  | grep -E 'JOURNAL vs WALLET|Journal Per-Wallet Drift|Journal Liability|NATS consumer lag|nats_lag_scrape' \
  | tail -30 || echo "(no drift/lag lines in 2h)"

# Live dual-write drift query (same invariant as reconciliation)
echo "=== live per-wallet journal drift query (top 10) ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "
SELECT w.id::text AS wallet_id,
  COALESCE(j.liability_sum, 0) AS liability_sum,
  w.balance_lamports,
  COALESCE(j.liability_sum, 0) + w.balance_lamports AS diff
FROM wallets w
LEFT JOIN (
  SELECT wallet_id, SUM(amount_lamports) AS liability_sum
  FROM ledger_journal_lines
  WHERE account_code = '2100' AND wallet_id IS NOT NULL
  GROUP BY wallet_id
) j ON j.wallet_id = w.id
WHERE COALESCE(j.liability_sum, 0) + w.balance_lamports <> 0
ORDER BY ABS(COALESCE(j.liability_sum, 0) + w.balance_lamports) DESC
LIMIT 10;
" || echo "(drift query failed — table may be absent)"

echo OPS_CHAOS_WATCH_DONE
