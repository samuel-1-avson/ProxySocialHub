#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
echo "=== listeners ==="
ss -lntp | grep -E '3128|8090' || true
echo "=== docker edge ports ==="
docker ps --format '{{.Names}} {{.Ports}}' | grep -iE 'edge|gateway' || true
echo "=== compose tunnel env ==="
grep -E 'EDGE_GATEWAY|TUNNEL' .env 2>/dev/null | sed 's/=.*/=***/' || true
docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml exec -T edge-gateway sh -c 'printenv PORT TUNNEL_PORT 2>/dev/null; ss -lntp 2>/dev/null | head -20' || true
echo DONE
