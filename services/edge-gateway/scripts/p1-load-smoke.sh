#!/usr/bin/env bash
# Lightweight load smoke against a running edge-gateway (health/metrics).
# For full CONNECT tunnel load, use your provider test harness + wrk/hey against :8090.
#
# Usage:
#   ./scripts/p1-load-smoke.sh
#   BASE_URL=http://127.0.0.1:8090 CONCURRENCY=50 DURATION=30s ./scripts/p1-load-smoke.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8090}"
CONCURRENCY="${CONCURRENCY:-20}"
DURATION="${DURATION:-15s}"

echo "Target: $BASE_URL (health + metrics)"
curl -sf "$BASE_URL/health" >/dev/null
curl -sf "$BASE_URL/ready" >/dev/null || echo "warn: /ready not 200 (Redis/providers?)"

if command -v hey >/dev/null 2>&1; then
  echo "== hey /health =="
  hey -z "$DURATION" -c "$CONCURRENCY" "$BASE_URL/health"
  echo "== hey /metrics =="
  hey -z "$DURATION" -c "$CONCURRENCY" "$BASE_URL/metrics"
elif command -v bombardier >/dev/null 2>&1; then
  echo "== bombardier /health =="
  bombardier -d "${DURATION%s}" -c "$CONCURRENCY" "$BASE_URL/health"
else
  echo "Install 'hey' or 'bombardier' for load generation; falling back to curl loop."
  end=$((SECONDS + 15))
  ok=0
  while [[ $SECONDS -lt $end ]]; do
    curl -sf -o /dev/null "$BASE_URL/health" && ok=$((ok + 1)) || true
  done
  echo "Completed $ok health checks in ~15s"
fi

echo "Done. For tunnel/CPU validation, run provider+client integration load separately."
