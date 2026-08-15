#!/usr/bin/env bash
# Sprint J0 remote deploy on proxyhubb-testnet
set -euo pipefail
cd /opt/proxyhubb
DC=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "== apply migration 000141 =="
if [ -f migrations/000141_session_gateway_cache.up.sql ]; then
  sudo docker exec -i proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb < migrations/000141_session_gateway_cache.up.sql
fi
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -At -c \
  "SELECT to_regclass('public.session_gateway_cache');" | grep -q session_gateway_cache

echo "== build/recreate control-api + edge-gateway =="
"${DC[@]}" up -d --build --force-recreate --no-deps control-api edge-gateway

for i in $(seq 1 60); do
  st=$(sudo docker inspect proxyhubb-control-api-1 --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
  echo "control-api health=$st"
  [ "$st" = "healthy" ] && break
  sleep 5
done

for i in $(seq 1 40); do
  st=$(sudo docker inspect proxyhubb-edge-gateway-1 --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
  echo "edge health=$st"
  [ "$st" = "healthy" ] && break
  sleep 5
done

echo "SPRINT_J0_DEPLOY_READY"
