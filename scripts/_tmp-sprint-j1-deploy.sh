#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
DC=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${DC[@]}" up -d --build --force-recreate --no-deps control-api
for i in $(seq 1 40); do
  st=$(sudo docker inspect proxyhubb-control-api-1 --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
  echo "health=$st"
  [ "$st" = "healthy" ] && break
  sleep 5
done
echo "SPRINT_J1_DEPLOY_READY"
