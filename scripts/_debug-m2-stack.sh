#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
RPW=$(grep -E '^REDIS_PASSWORD=' .env | head -1 | cut -d= -f2- | tr -d '\r')
echo '=== ps ==='
docker ps -a --filter name=redis --format 'table {{.Names}}\t{{.Status}}'
echo '=== redis logs ==='
docker logs proxyhubb-redis-1 2>&1 | tail -20
echo '=== replica logs ==='
docker logs proxyhubb-redis-replica-1 2>&1 | tail -15
echo '=== sentinel logs ==='
docker logs proxyhubb-redis-sentinel-1-1 2>&1 | tail -20
echo '=== direct ping ==='
timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine redis-cli -h redis -a "$RPW" --no-auth-warning PING || true
timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine redis-cli -h redis-sentinel-1 -p 26379 PING || true
timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine redis-cli -h redis-proxy -a "$RPW" --no-auth-warning PING || true
echo DONE
