#!/bin/bash
set -euo pipefail
echo "=== control-api buyer/gateway env ==="
sudo docker exec proxyhubb-control-api-1 sh -c 'env' | grep -iE 'PROXY|GATEWAY|BUYER|EDGE|PUBLIC' | sed -E 's/(KEY|SECRET|TOKEN|PASSWORD)=.*/\1=***/' || true
echo "=== .env relevant ==="
grep -E '^(EDGE_GATEWAY_BUYER_HOST|NEXT_PUBLIC_PROXY_ENDPOINT|GATEWAY_PUBLIC_URL|PROVIDER_TUNNEL_PUBLIC_ADDR|EDGE_GATEWAY_BUYER_PORT)=' /opt/proxyhubb/.env 2>/dev/null || true
echo "=== edge ports ==="
sudo docker ps --format '{{.Names}} {{.Ports}}' | grep -iE 'edge|gateway|web' || true
echo "=== public ip ==="
curl -sS -m 5 ifconfig.me || curl -sS -m 5 icanhazip.com || true
echo
echo "=== dns proxyhubb.com ==="
getent hosts proxyhubb.com api.proxyhubb.com proxy.proxyhubb.com 2>/dev/null || true
dig +short proxyhubb.com A 2>/dev/null | head -3 || true
