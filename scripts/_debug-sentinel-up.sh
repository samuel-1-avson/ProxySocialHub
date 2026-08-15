#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
docker ps -a --filter name=sentinel --format 'table {{.Names}}\t{{.Status}}'
echo '--- logs1 ---'
docker logs proxyhubb-redis-sentinel-1-1 2>&1 | tail -25
echo '--- dns ---'
timeout 5 docker run --rm --network proxyhubb_backend busybox:1.36 nslookup redis-sentinel-1 2>&1 | head -10 || true
timeout 5 docker run --rm --network proxyhubb_backend redis:7-alpine redis-cli -h redis-sentinel-1 -p 26379 PING || true
echo DONE
