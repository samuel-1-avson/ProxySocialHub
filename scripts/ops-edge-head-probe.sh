#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
CID=$(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml ps -q edge-gateway)

echo "=== HEAD vs GET /health (host) ==="
curl -sS -o /dev/null -w "GET=%{http_code}\n" http://127.0.0.1:8090/health
curl -sS -I -o /tmp/head.out -w "HEAD=%{http_code}\n" http://127.0.0.1:8090/health || true
head -20 /tmp/head.out || true

echo "=== wget spider vs get (in container) ==="
docker exec "$CID" sh -c 'wget --no-verbose --tries=1 --spider http://127.0.0.1:8090/health; echo spider_exit=$?'
docker exec "$CID" sh -c 'wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:8090/health; echo get_exit=$?'
docker exec "$CID" sh -c 'curl -sS -o /dev/null -w "curl_get=%{http_code}\n" http://127.0.0.1:8090/health'
docker exec "$CID" sh -c 'curl -sS -o /dev/null -w "curl_head=%{http_code}\n" -I http://127.0.0.1:8090/health'

echo EDGE_HEAD_PROBE_DONE
