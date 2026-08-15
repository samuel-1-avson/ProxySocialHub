#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
echo '=== proxy container ==='
docker ps -a --filter name=redis-proxy --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker logs proxyhubb-redis-proxy-1 2>&1 | tail -40
echo '=== haproxy cfg (password redacted) ==='
sudo sed 's/AUTH\\ [^\\]*/AUTH\\ ***/' /opt/proxyhubb/infra/redis/haproxy-redis-ha.cfg | head -40
echo '=== redis role ==='
RPW=$(grep -E '^REDIS_PASSWORD=' .env | head -1 | cut -d= -f2- | tr -d '\r')
sudo docker run --rm --network proxyhubb_backend redis:7-alpine redis-cli -h redis -a "$RPW" --no-auth-warning INFO replication | tr -d '\r' | grep -E 'role|master_host|master_link' || true
sudo docker run --rm --network proxyhubb_backend redis:7-alpine redis-cli -h redis-replica -a "$RPW" --no-auth-warning INFO replication | tr -d '\r' | grep -E 'role|master_host|master_link' || true
echo '=== control-api REDIS_URL host ==='
docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.redis-ha.yml \
  exec -T control-api printenv REDIS_URL | sed 's#://:.*@#://:***@#'
echo '=== proxy stats / nc ==='
sudo docker run --rm --network proxyhubb_backend busybox:1.36 nc -zv redis-proxy 6379 2>&1 || true
echo M2_DEBUG_DONE
