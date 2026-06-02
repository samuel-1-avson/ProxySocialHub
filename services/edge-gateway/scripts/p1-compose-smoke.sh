#!/usr/bin/env bash
# Bring up minimal edge+redis compose stack, wait for health, run P1 load smoke.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker-compose.resilience.yml}"
BASE_URL="${BASE_URL:-http://127.0.0.1:18090}"
WAIT_SECS="${WAIT_SECS:-120}"

cd "$ROOT"

echo "== docker compose up (resilience test stack) =="
docker compose -f "$COMPOSE_FILE" up -d --build

echo "== waiting for $BASE_URL/health (max ${WAIT_SECS}s) =="
deadline=$((SECONDS + WAIT_SECS))
until curl -sf "$BASE_URL/health" >/dev/null 2>&1; do
  if [[ $SECONDS -ge $deadline ]]; then
    echo "error: gateway not healthy after ${WAIT_SECS}s" >&2
    docker compose -f "$COMPOSE_FILE" logs edge-gateway --tail 40 >&2 || true
    exit 1
  fi
  sleep 2
done
echo "health OK"

echo ""
export BASE_URL
SCRIPT_DIR="$(dirname "$0")"
"$SCRIPT_DIR/p1-load-smoke.sh"

echo ""
echo "P1 compose smoke complete."
echo "Teardown: docker compose -f $COMPOSE_FILE down"
