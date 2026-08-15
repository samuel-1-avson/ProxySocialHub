#!/usr/bin/env bash
set -euo pipefail
echo "health=$(docker inspect -f '{{.State.Health.Status}}' proxyhubb-provider-node 2>/dev/null || echo missing)"
echo "=== logs ==="
docker logs proxyhubb-provider-node --tail 60 2>&1 || true
echo "=== edge tunnel hints ==="
docker logs proxyhubb-edge-gateway-1 --tail 30 2>&1 | grep -iE 'tunnel|provider|yamux|quic|peer' || true
echo PROVIDER_DIAG_DONE
