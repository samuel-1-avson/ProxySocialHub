#!/usr/bin/env bash
# P2 admission soak — hold TCP permits, flood /health, expect 503, recovery.
set -euo pipefail
GATEWAY_HOST="${GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${GATEWAY_PORT:-18090}"
LIMIT="${MAX_CONCURRENT_CONNECTIONS:-6}"
BASE="http://${GATEWAY_HOST}:${GATEWAY_PORT}"
WORKERS="${WORKERS:-40}"
REQUESTS="${REQUESTS:-30}"

echo "== P2 admission soak on ${BASE} (hold=${LIMIT}) =="

holders=()
cleanup() {
  for fd in "${holders[@]}"; do
    eval "exec ${fd}>&-" 2>/dev/null || true
  done
}
trap cleanup EXIT

for _ in $(seq 1 "$LIMIT"); do
  exec {fd}<>/dev/tcp/"$GATEWAY_HOST"/"$GATEWAY_PORT"
  holders+=("$fd")
done
sleep 0.3

tmp=$(mktemp)
trap 'rm -f "$tmp"; cleanup' EXIT
for _ in $(seq 1 "$WORKERS"); do
  (
    for _ in $(seq 1 "$REQUESTS"); do
      code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}/health" || echo 0)
      echo "$code"
    done
  ) >>"$tmp" &
done
wait

sort "$tmp" | uniq -c | sort -rn

if ! grep -qx '503' "$tmp" 2>/dev/null && ! grep -q '^503$' "$tmp"; then
  if ! grep -q '503' "$tmp"; then
    echo "FAIL: no 503 under saturated admission" >&2
    exit 1
  fi
fi
echo "OK saw HTTP 503"

cleanup
trap - EXIT
sleep 2
curl -sf "${BASE}/health" >/dev/null
echo "OK health recovered"
