#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
PID=20b1ea2e-dd11-4886-939a-00416271b9ff

echo "=== proposal ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "
SELECT id::text, title, status, on_chain_pda, yes_votes, no_votes, start_time, end_time
FROM governance_proposals WHERE id = '${PID}';
"

echo "=== vote/build/relay/vote around 14:58 ==="
"${COMPOSE[@]}" logs control-api --since 30m 2>/dev/null \
  | grep -A2 -E "14:58:0|14:58:1|vote/build|vote/relay|/vote\"|Failed to verify|not finalized|ReadGovernance|castVote|mirror" \
  | tail -80

echo "=== gin lines for this proposal ==="
"${COMPOSE[@]}" logs control-api --since 30m 2>/dev/null \
  | grep "${PID}" | tail -40
