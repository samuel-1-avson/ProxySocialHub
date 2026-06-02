#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=p3-compose.sh
source "${SCRIPT_DIR}/p3-compose.sh"

EDGE_A_PORT="${P3_EDGE_A_PORT:-28090}"
EDGE_B_PORT="${P3_EDGE_B_PORT:-28091}"

echo "== P3 multipod smoke =="
for port in "$EDGE_A_PORT" "$EDGE_B_PORT"; do
  curl -sf "http://127.0.0.1:${port}/health" >/dev/null
  echo "OK health :${port}"
done

json='{"node_id":"p3-smoke-node","pod_id":"edge-a","region":null,"updated_at":0,"country_code":"US","latency_ms":10,"is_healthy":true,"quality_score":1.0}'
p3_redis_set_json "eg:provider:owner:p3-smoke-node" "$json" 120
echo "OK seeded Redis directory entry"

curl -sf "http://127.0.0.1:${EDGE_B_PORT}/debug/nodes" >/dev/null
echo "OK edge-b debug/nodes"

echo "P3 multipod smoke passed."
