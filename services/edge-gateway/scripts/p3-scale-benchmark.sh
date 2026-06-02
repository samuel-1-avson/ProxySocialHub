#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/p3-compose.sh"

EDGE_A_PORT="${P3_EDGE_A_PORT:-28090}"
EDGE_B_PORT="${P3_EDGE_B_PORT:-28091}"

echo "== P3 scale benchmark =="
for port in "$EDGE_A_PORT" "$EDGE_B_PORT"; do
  curl -sf "http://127.0.0.1:${port}/health" >/dev/null
done

seed_n() {
  local n=$1 owner=$2
  p3_redis_cli --scan --pattern 'eg:provider:owner:p3-bench-*' | while read -r k; do
    [[ -n "$k" ]] && p3_redis_cli DEL "$k" >/dev/null
  done
  for i in $(seq 0 $((n - 1))); do
    local node="p3-bench-${owner}-${i}"
    local json="{\"node_id\":\"${node}\",\"pod_id\":\"${owner}\",\"region\":null,\"updated_at\":0,\"country_code\":\"US\",\"latency_ms\":10,\"is_healthy\":true,\"quality_score\":1.0}"
    p3_redis_set_json "eg:provider:owner:${node}" "$json" 300
  done
}

for n in 10 50 100; do
  echo "-- seed ${n} on edge-a --"
  seed_n "$n" edge-a
  total_b=$(curl -sf "http://127.0.0.1:${EDGE_B_PORT}/debug/directory/stats" | sed -n 's/.*"directory_total":\([0-9]*\).*/\1/p')
  echo "  directory_total on edge-b: ${total_b}"
  if [[ "${total_b:-0}" -lt "$n" ]]; then
    echo "FAIL: edge-b directory_total ${total_b} < ${n}" >&2
    exit 1
  fi
done

echo "OK P3 scale benchmark"
