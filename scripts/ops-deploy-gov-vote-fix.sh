#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
tr -d '\015' </tmp/governance_api.go >/opt/proxyhubb/services/control-api/internal/api/governance.go
tr -d '\015' </tmp/governance_solana.go >/opt/proxyhubb/services/control-api/internal/solana/governance.go

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
if [[ -f docker-compose.redis-ha.yml ]]; then
  COMPOSE+=(-f docker-compose.redis-ha.yml)
fi

export ALLOW_EMERGENCY_WEB_BUILD=1
export WEB_TAR=/tmp/gov-vote-fix.tar.gz
bash scripts/gcp-deploy-web-emergency-build.sh

"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 40); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-control-api-1 2>/dev/null || echo missing)
  echo "api_try=$i status=$st"
  [[ "$st" == "healthy" ]] && break
  sleep 3
done
[[ "$st" == "healthy" ]] || { echo CONTROL_API_NOT_HEALTHY; exit 1; }
echo GOV_VOTE_MIRROR_FIX_DONE
