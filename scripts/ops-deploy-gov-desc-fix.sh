#!/usr/bin/env bash
# Deploy governance description min-length UX + friendlier API bind errors.
set -euo pipefail
cd /opt/proxyhubb

tr -d '\015' </tmp/governance.go >/opt/proxyhubb/services/control-api/internal/api/governance.go

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
if [[ -f docker-compose.redis-ha.yml ]]; then
  COMPOSE+=(-f docker-compose.redis-ha.yml)
fi

export ALLOW_EMERGENCY_WEB_BUILD=1
export WEB_TAR=/tmp/gov-desc-fix.tar.gz
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

echo "=== verify create page hint ==="
curl -sS -m 20 https://proxyhubb.com/governance/create | grep -oE 'Min 20 characters|at least 20 characters' | head -5 || echo 'HINT_NOT_IN_HTML_OK_IF_CLIENT_BUNDLE'
echo GOV_DESC_DEPLOY_DONE
