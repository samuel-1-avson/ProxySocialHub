#!/usr/bin/env bash
# Restore redis after interrupted M2 chaos, then prove Sentinel failover.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
  -f docker-compose.redis-ha.yml)
RPW=$(grep -E '^REDIS_PASSWORD=' .env | head -1 | cut -d= -f2- | tr -d '\r')

docker update --restart=unless-stopped proxyhubb-redis-1 >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d redis redis-replica redis-sentinel-1 redis-sentinel-2 redis-sentinel-3 redis-proxy
sleep 5

for i in $(seq 1 30); do
  if timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
    redis-cli -h redis-proxy -a "$RPW" --no-auth-warning PING 2>/dev/null | tr -d '\r' | grep -q PONG; then
    echo "proxy_ok"
    break
  fi
  echo "proxy_wait=$i"
  sleep 2
  [[ $i -eq 30 ]] && exit 1
done

bash /opt/proxyhubb/scripts/ops-m2-redis-ha-chaos.sh
