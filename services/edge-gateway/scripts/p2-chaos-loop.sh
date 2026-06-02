#!/usr/bin/env bash
# P2 extended chaos: repeat Redis stop/start with 407 probe and health recovery.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
GATEWAY_HOST="${GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${GATEWAY_PORT:-18090}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.resilience.yml}"
REDIS_SERVICE="${REDIS_SERVICE:-redis}"
ITERATIONS="${CHAOS_ITERATIONS:-3}"
HEALTH="http://${GATEWAY_HOST}:${GATEWAY_PORT}/health"

curl -sf "$HEALTH" >/dev/null || {
  echo "Gateway not up. Run: docker compose -f $COMPOSE_FILE up -d --build" >&2
  exit 1
}

read_connect_response() {
  local auth
  auth=$(printf '%s' 'smoke-user:smoke-pass' | base64 | tr -d '\n')
  {
    printf 'CONNECT example.com:443 HTTP/1.1\r\n'
    printf 'Host: example.com:443\r\n'
    printf 'Proxy-Authorization: Basic %s\r\n' "$auth"
    printf '\r\n'
  } | nc -w 5 "$GATEWAY_HOST" "$GATEWAY_PORT" 2>/dev/null | head -c 512 || true
}

echo "== P2 chaos loop (${ITERATIONS} cycles) =="
for i in $(seq 1 "$ITERATIONS"); do
  echo "-- cycle ${i}/${ITERATIONS}: stop Redis --"
  docker compose -f "$COMPOSE_FILE" stop "$REDIS_SERVICE"
  sleep 5
  resp=$(read_connect_response)
  if ! grep -q '407' <<<"$resp"; then
    echo "expected 407, got: $resp" >&2
    exit 1
  fi
  echo "  CONNECT 407 OK"
  echo "-- cycle ${i}/${ITERATIONS}: start Redis --"
  docker compose -f "$COMPOSE_FILE" start "$REDIS_SERVICE"
  sleep 4
  curl -sf "$HEALTH" >/dev/null
  echo "  health OK"
done
echo "P2 chaos loop complete."
