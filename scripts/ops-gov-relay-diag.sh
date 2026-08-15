#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
PID=20b1ea2e-dd11-4886-939a-00416271b9ff

echo "=== recent vote endpoints ==="
"${COMPOSE[@]}" logs control-api --since 25m 2>/dev/null | grep -F "$PID" | tail -40

echo
echo "=== relay / cast errors ==="
"${COMPOSE[@]}" logs control-api --since 25m 2>/dev/null \
  | grep -iE 'relay|cast_governance|already|custom program|failed to relay|SendEncoded|Simulation|AccountAlready|vote/relay|vote/build' \
  | tail -60

echo
echo "=== proposal + votes DB ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c "
SELECT id::text, status, onchain_pda, yes_votes, no_votes FROM governance_proposals WHERE id='${PID}';
SELECT id::text, voter_id::text, vote, weight, created_at FROM governance_votes WHERE proposal_id='${PID}';
"
