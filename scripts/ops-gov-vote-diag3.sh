#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
PID=20b1ea2e-dd11-4886-939a-00416271b9ff

echo "=== proposal row ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -F $'\t' -c "
SELECT id::text, title, status, onchain_pda, yes_votes, no_votes, ipfs_hash
FROM governance_proposals WHERE id = '${PID}';
"

echo "=== gin + errors for proposal ==="
"${COMPOSE[@]}" logs control-api --since 40m 2>/dev/null | grep -F "$PID" | tail -30

echo "=== recovery / verify errors near vote ==="
"${COMPOSE[@]}" logs control-api --since 40m 2>/dev/null \
  | grep -E 'Failed to verify on-chain vote|Failed to read on-chain|not finalized|ReadGovernance|data too short|castVote|vote transaction' \
  | tail -40
