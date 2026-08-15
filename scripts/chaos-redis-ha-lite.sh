#!/usr/bin/env bash
# Redis HA-lite chaos drill (hydrate + spill + recovery).
#
# Prerequisites: full stack up (postgres, redis, control-api, edge-gateway) with
# GATEWAY_SHARED_SECRET and a seedable session. Minimal resilience compose is
# NOT enough — hydrate needs control-api + PG.
#
# Usage (on VM or local with stack running):
#   SESSION_USER=buyer-cred-user ./scripts/chaos-redis-ha-lite.sh
#
# Phases:
#   1) Assert edge /health
#   2) Flush session key → CONNECT/auth should still work via hydrate (if CONTROL_API set)
#   3) Stop Redis → RPM path fail-open; auth via hydrate if control-api reachable
#   4) Start Redis → health recovers
#
# Exit non-zero on unexpected failures.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GATEWAY_HOST="${GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${GATEWAY_PORT:-8090}"
API_BASE="${API_BASE:-http://127.0.0.1:8080}"
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml -f docker-compose.testnet.yml}"
REDIS_SERVICE="${REDIS_SERVICE:-redis}"
SESSION_USER="${SESSION_USER:-}"
HEALTH="http://${GATEWAY_HOST}:${GATEWAY_PORT}/health"

echo "== Redis HA-lite chaos =="
curl -sf "$HEALTH" >/dev/null || {
  echo "Gateway not healthy at $HEALTH" >&2
  exit 1
}
echo "OK gateway health"

if [[ -n "$SESSION_USER" ]]; then
  echo "-- phase: delete Redis session key (hydrate path) --"
  # Best-effort: docker compose exec redis
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES exec -T "$REDIS_SERVICE" \
    redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} DEL "session:${SESSION_USER}" >/dev/null || true
  # Probe hydrate API directly
  if curl -sf -H "X-Gateway-Auth: ${GATEWAY_SHARED_SECRET:-}" \
    "${API_BASE}/v1/gateway/sessions/hydrate?username=${SESSION_USER}" >/dev/null 2>&1; then
    echo "OK hydrate endpoint responded"
  else
    echo "WARN hydrate probe failed (check GATEWAY_SHARED_SECRET / session dual-write)" >&2
  fi
fi

echo "-- phase: stop Redis --"
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES stop "$REDIS_SERVICE"
sleep 3

# Edge may still serve /health from process; ready may fail — record either way.
if curl -sf "$HEALTH" >/dev/null; then
  echo "OK gateway process still answering /health with Redis down"
else
  echo "WARN /health failed with Redis down (acceptable if readiness-gated)" >&2
fi

echo "-- phase: start Redis --"
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES start "$REDIS_SERVICE"
sleep 5
curl -sf "$HEALTH" >/dev/null
echo "OK health after Redis restart"

echo "== chaos-redis-ha-lite complete =="
echo "Manual follow-ups:"
echo "  - Confirm metering_wal_spill rows if traffic ran during Redis down"
echo "  - Confirm session_gateway_cache hydrate rewarmed session:${SESSION_USER:-<user>}"
echo "  - Edge unit: RPM fail-open on Redis errors (cargo test)"
