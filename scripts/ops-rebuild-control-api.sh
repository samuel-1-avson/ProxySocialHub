#!/usr/bin/env bash
# Rebuild and restart control-api on gcp-testnet with session Redis key fix.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== sync fixed sources ==="
# sources are expected already on /opt/proxyhubb from scp/rsync by operator

echo "=== build control-api ==="
"${COMPOSE[@]}" build control-api
echo "=== restart control-api ==="
"${COMPOSE[@]}" up -d control-api
for i in $(seq 1 40); do
  st=$(docker inspect -f '{{.State.Health.Status}}' proxyhubb-control-api-1 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  [[ "$st" == "healthy" ]] && break
  sleep 3
done
curl -sS -m 5 http://127.0.0.1:18080/health || true
echo
echo CONTROL_API_REBUILD_DONE
