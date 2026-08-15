#!/usr/bin/env bash
# Capture recent governance create failures from control-api.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
if [[ -f docker-compose.redis-ha.yml ]]; then
  COMPOSE+=(-f docker-compose.redis-ha.yml)
fi

echo "=== control-api health ==="
docker inspect -f '{{.State.Health.Status}}' proxyhubb-control-api-1 2>/dev/null || echo missing

echo "=== recent governance / createProposal / IPFS / proposal logs ==="
"${COMPOSE[@]}" logs control-api --since 30m 2>/dev/null \
  | grep -iE 'governance|createProposal|proposal|ipfs|pinata|PHB|CreateProposal|failed to create|on-chain|oracle|execution' \
  | tail -80 || true

echo "=== PHB / governance env (redacted) ==="
grep -E '^(PHB_TOKEN_MINT|GOVERNANCE_|PINATA_|IPFS_|PROXYHUB_GOVERNANCE)' .env 2>/dev/null \
  | sed -E 's/(JWT|TOKEN|KEY|SECRET)=.*/\1=***REDACTED***/' || true
