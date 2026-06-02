#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/p3-compose.sh"

EDGE_A_PORT="${P3_EDGE_A_PORT:-28090}"
EDGE_B_PORT="${P3_EDGE_B_PORT:-28091}"
NODE="${P3_DRAIN_NODE:-p3-drain-migrate-node}"
BASE_A="http://127.0.0.1:${EDGE_A_PORT}"
BASE_B="http://127.0.0.1:${EDGE_B_PORT}"

echo "== P3 pod drain / ownership migration =="
p3_redis_cli DEL "eg:provider:owner:${NODE}" >/dev/null || true
json="{\"node_id\":\"${NODE}\",\"pod_id\":\"edge-a\",\"region\":null,\"updated_at\":0,\"country_code\":\"US\",\"latency_ms\":10,\"is_healthy\":true,\"quality_score\":1.0}"
p3_redis_set_json "eg:provider:owner:${NODE}" "$json" 120

curl -sf -X POST "${BASE_A}/admin/drain" >/dev/null
code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_A}/health" || true)
[[ "$code" == "503" ]] || { echo "expected 503 on draining health, got ${code}" >&2; exit 1; }

curl -sf -X POST "${BASE_A}/admin/drain/ownership" >/dev/null
val=$(p3_redis_cli GET "eg:provider:owner:${NODE}" || true)
if [[ -n "${val}" && "${val}" != "(nil)" ]]; then
  echo "key still set after release" >&2
  exit 1
fi

json_b="{\"node_id\":\"${NODE}\",\"pod_id\":\"edge-b\",\"region\":null,\"updated_at\":0,\"country_code\":\"US\",\"latency_ms\":10,\"is_healthy\":true,\"quality_score\":1.0}"
p3_redis_set_json "eg:provider:owner:${NODE}" "$json_b" 120
curl -sf "${BASE_B}/health" >/dev/null
curl -sf "${BASE_B}/debug/directory/stats" >/dev/null
echo "OK P3 pod drain / migration smoke passed"
