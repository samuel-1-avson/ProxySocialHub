#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb
echo "=== where buyer host is set ==="
sudo docker inspect proxyhubb-control-api-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'EDGE_GATEWAY_BUYER|NEXT_PUBLIC_PROXY|GATEWAY_PUBLIC|PROVIDER_TUNNEL|TESTNET_PUBLIC' || true
ls -la .env* 2>/dev/null | head -20
echo "=== search env files ==="
sudo grep -Rsn 'proxy.testnet.example.com\|EDGE_GATEWAY_BUYER_HOST' /opt/proxyhubb --include='*.env*' --include='*.yml' --include='*.yaml' 2>/dev/null | head -40
