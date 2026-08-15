#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
RPW=$(grep -E '^REDIS_PASSWORD=' .env | head -1 | cut -d= -f2- | tr -d '\r')
echo '=== containers ==='
docker ps -a --filter name=redis --format 'table {{.Names}}\t{{.Status}}'
echo '=== replica role ==='
timeout 8 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-replica -a "$RPW" --no-auth-warning INFO replication | tr -d '\r' | grep -E 'role|master' || true
echo '=== sentinel get-master ==='
timeout 8 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-sentinel-1 -p 26379 SENTINEL get-master-addr-by-name mymaster || true
echo '=== sentinel masters (trimmed) ==='
timeout 8 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-sentinel-1 -p 26379 SENTINEL masters | tr -d '\r' | head -60 || true
echo '=== proxy get with timeout ==='
timeout 8 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-proxy -a "$RPW" --no-auth-warning PING || echo 'proxy_ping_failed'
echo '=== haproxy logs ==='
docker logs proxyhubb-redis-proxy-1 2>&1 | tail -20
echo '=== start redis back if stopped ==='
docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.redis-ha.yml start redis || true
sleep 3
echo M2_FAILOVER_DEBUG_DONE
