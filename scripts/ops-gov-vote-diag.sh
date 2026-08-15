#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
PID="${1:-20b1ea2e-dd11-4886-939a-00416271b9ff}"

echo "=== recent vote/build/relay logs ==="
"${COMPOSE[@]}" logs control-api --since 45m 2>/dev/null \
  | grep -iE "governance|vote|relay|build.*tx|20[Bb]1|[Ee][Aa]2[Ee]|cast_governance|Failed to|panic|invalid" \
  | tail -100 || true

echo
echo "=== proposal row ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 -c "
SELECT id::text, title, status, on_chain_pda, ipfs_hash, start_time, end_time, proposer_id::text
FROM proposals WHERE id::text ILIKE '${PID}%' OR id::text ILIKE lower('${PID}') LIMIT 5;
" 2>/dev/null || "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "\dt *proposal*"

echo
echo "=== votes for proposal ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "
SELECT id::text, voter_id::text, choice, voting_power, on_chain_tx_sig, created_at
FROM votes WHERE proposal_id::text ILIKE '${PID}%'
ORDER BY created_at DESC LIMIT 10;
" 2>/dev/null || true
