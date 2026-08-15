#!/usr/bin/env bash
set -euo pipefail
# Search full logs for smoke sig and recent native_deposit events
SIG=49Vgc9uMqhecm4ZyMB3Tcy2HGnTDPJwVKCXkWUHREbbJpJCSownuVZSieRqMTEm9Ch7ByCsdWbEssn1kwVYDdwav
sudo docker logs proxyhubb-control-api-1 --since 20m 2>&1 | grep -F "$SIG" | tail -20 || echo "no sig in logs"
echo '--- native_deposit events ---'
sudo docker logs proxyhubb-control-api-1 --since 20m 2>&1 | grep -F 'native_deposit' | tail -20 || true
echo '--- Auto-Deposit ---'
sudo docker logs proxyhubb-control-api-1 --since 20m 2>&1 | grep -F 'Auto-Deposit' | tail -30 || true
echo '--- Processing escrow ---'
sudo docker logs proxyhubb-control-api-1 --since 20m 2>&1 | grep -F 'Processing escrow event' | tail -20 || true
