#!/usr/bin/env bash
# P2 smoke: admission 503 (hold permits) + Redis down → CONNECT 407.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker-compose.resilience.yml}"
HOST="${GATEWAY_HOST:-127.0.0.1}"
PORT="${GATEWAY_PORT:-18090}"
REDIS_SERVICE="${REDIS_SERVICE:-redis}"
# Match MAX_CONCURRENT_CONNECTIONS in docker-compose.resilience.yml unless overridden.
LIMIT="${MAX_CONCURRENT_CONNECTIONS:-6}"

cd "$ROOT"

if ! curl -sf "http://${HOST}:${PORT}/health" >/dev/null 2>&1; then
  echo "Gateway not reachable at ${HOST}:${PORT}. Start stack first:" >&2
  echo "  docker compose -f $COMPOSE_FILE up -d --build" >&2
  echo "  ./scripts/p1-compose-smoke.sh" >&2
  exit 1
fi

echo "== admission 503 (hold ${LIMIT} TCP connections, expect 503 on next) =="
HOLDERS=()
for ((i = 0; i < LIMIT; i++)); do
  exec {fd}<>/dev/tcp/"${HOST}"/"${PORT}"
  HOLDERS+=("$fd")
done

sleep 0.3
exec {probe}<>/dev/tcp/"${HOST}"/"${PORT}"
RESPONSE=""
if read -r -t 2 -n 256 RESPONSE <&${probe}; then
  :
fi
exec {probe}<&-

if [[ "$RESPONSE" != *"503"* ]]; then
  echo "error: expected HTTP 503 on saturated admission, got: ${RESPONSE:-<empty>}" >&2
  for fd in "${HOLDERS[@]}"; do exec {fd}<&-; done
  exit 1
fi
echo "admission 503 OK"

for fd in "${HOLDERS[@]}"; do exec {fd}<&-; done
sleep 0.5

echo "== Redis chaos (stop ${REDIS_SERVICE} → CONNECT 407) =="
docker compose -f "$COMPOSE_FILE" stop "$REDIS_SERVICE"

cleanup_redis() {
  docker compose -f "$COMPOSE_FILE" start "$REDIS_SERVICE" >/dev/null 2>&1 || true
}
trap cleanup_redis EXIT

sleep 5

AUTH_B64="$(printf '%s' 'smoke-user:smoke-pass' | base64 | tr -d '\n')"
REQ=$'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: Basic '"${AUTH_B64}"$'\r\n\r\n'

CONNECT_RESP=""
if command -v nc >/dev/null 2>&1; then
  CONNECT_RESP="$(printf '%s' "$REQ" | nc -w 3 "${HOST}" "${PORT}" 2>/dev/null || true)"
else
  exec {cx}<>/dev/tcp/"${HOST}"/"${PORT}"
  printf '%s' "$REQ" >&${cx}
  read -r -t 3 -n 512 CONNECT_RESP <&${cx} || true
  exec {cx}<&-
fi
if [[ "$CONNECT_RESP" != *"407"* ]]; then
  echo "error: expected 407 after Redis stop, got:" >&2
  echo "$CONNECT_RESP" >&2
  exit 1
fi
echo "Redis-down CONNECT 407 OK"

trap - EXIT
cleanup_redis
sleep 3

if ! curl -sf "http://${HOST}:${PORT}/health" >/dev/null; then
  echo "warn: /health not OK after Redis restart (may need more time)" >&2
else
  echo "health OK after Redis restart"
fi

echo "P2 resilience smoke complete."
