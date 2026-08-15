#!/usr/bin/env bash
# Deploy KMS-safe CreateProposalOnChain fix.
set -euo pipefail
cd /opt/proxyhubb
tr -d '\015' </tmp/governance_solana.go >/opt/proxyhubb/services/control-api/internal/solana/governance.go
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
if [[ -f docker-compose.redis-ha.yml ]]; then
  COMPOSE+=(-f docker-compose.redis-ha.yml)
fi
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 40); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-control-api-1 2>/dev/null || echo missing)
  echo "api_try=$i status=$st"
  [[ "$st" == "healthy" ]] && break
  sleep 3
done
[[ "$st" == "healthy" ]] || { echo CONTROL_API_NOT_HEALTHY; exit 1; }
grep -n 'GetOraclePublicKey' services/control-api/internal/solana/governance.go | head -5
echo GOV_KMS_CREATE_PROPOSAL_FIX_DONE
