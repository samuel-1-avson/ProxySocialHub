#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.redis-ha.yml)
echo '=== ensure redis up for diagnosis baseline ==='
"${COMPOSE[@]}" start redis || true
sleep 3
echo '=== sentinel master detail ==='
timeout 8 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-sentinel-1 -p 26379 SENTINEL master mymaster || true
echo '=== ckquorum ==='
timeout 8 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-sentinel-1 -p 26379 SENTINEL ckquorum mymaster || true
echo '=== stop redis and watch sentinel for 20s ==='
"${COMPOSE[@]}" stop redis
for i in 1 2 3 4 5 6 7 8 9 10; do
  echo "-- t=${i}0s --"
  timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
    redis-cli -h redis-sentinel-1 -p 26379 SENTINEL master mymaster 2>/dev/null \
    | awk 'NR%2==1{k=$0;getline;print k"="$0}' | egrep 'flags|num-slaves|num-other-sentinels|address|ip|port|failover' || true
  sleep 2
done
echo '=== sentinel1 logs ==='
docker logs proxyhubb-redis-sentinel-1-1 2>&1 | tail -40
echo '=== start redis again ==='
"${COMPOSE[@]}" start redis
echo M2_SENTINEL_WATCH_DONE
