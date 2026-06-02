#!/usr/bin/env bash
# P3b split stack smoke. Prereq: ./scripts/p3-split-up.sh -Build
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=p3-split-compose.sh
source "${SCRIPT_DIR}/p3-split-compose.sh"
cd "${SCRIPT_DIR}/.."

EDGE_A="${P3_SPLIT_EDGE_A_PORT:-28100}"
EDGE_B="${P3_SPLIT_EDGE_B_PORT:-28101}"
TUNNEL_A_HTTP="${P3_SPLIT_TUNNEL_A_HTTP:-28110}"

echo "== P3b split smoke =="
for port in "$EDGE_A" "$EDGE_B" "$TUNNEL_A_HTTP" "${P3_SPLIT_TUNNEL_B_HTTP:-28111}"; do
  curl -fsS "http://127.0.0.1:${port}/health" >/dev/null
  echo "OK health :${port}"
done

tunnel_resp="$(printf 'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n' | nc -w 2 127.0.0.1 "$TUNNEL_A_HTTP" 2>/dev/null || true)"
echo "$tunnel_resp" | grep -q 403
echo "OK tunnel-a buyer CONNECT -> 403"

ingress_resp="$(printf 'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n' | nc -w 2 127.0.0.1 "$EDGE_B" 2>/dev/null || true)"
echo "$ingress_resp" | grep -q 407
echo "OK edge-b buyer CONNECT without auth -> 407"

json='{"node_id":"p3b-smoke-node","pod_id":"tunnel-a","region":null,"updated_at":0,"country_code":"US","latency_ms":10,"is_healthy":true,"quality_score":1.0}'
p3_redis_set_json "eg:provider:owner:p3b-smoke-node" "$json" 120
echo "OK seeded directory (owner=tunnel-a)"

stats="$(curl -fsS "http://127.0.0.1:${EDGE_B}/debug/directory/stats")"
echo "$stats" | grep -q p3b-smoke-node
echo "OK ingress sees directory entry"
echo "P3b split smoke passed."
