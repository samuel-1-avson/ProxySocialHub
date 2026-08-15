#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
RPW=$(grep -E '^REDIS_PASSWORD=' .env | head -1 | cut -d= -f2- | tr -d '\r')
echo "pw_len=${#RPW}"
echo '=== containers ==='
docker ps -a --filter name=redis --format 'table {{.Names}}\t{{.Status}}'
echo '=== sentinel logs ==='
docker logs proxyhubb-redis-sentinel-1-1 2>&1 | tail -15 || true
echo '=== direct redis auth ==='
timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis -a "$RPW" --no-auth-warning PING || true
echo '=== haproxy cfg auth line (redacted) ==='
grep 'tcp-check send AUTH' infra/redis/haproxy-redis-ha.cfg | sed "s/${RPW}/***/g"
echo '=== haproxy logs ==='
docker logs proxyhubb-redis-proxy-1 2>&1 | tail -30
echo '=== recreate proxy and test ==='
docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.redis-ha.yml \
  up -d --force-recreate redis-proxy
sleep 4
timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis-proxy -a "$RPW" --no-auth-warning PING || echo PROXY_FAIL
timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine \
  redis-cli -h redis -a "$RPW" --no-auth-warning INFO replication | grep ^role || true
echo M2_PROXY_DEBUG_DONE
