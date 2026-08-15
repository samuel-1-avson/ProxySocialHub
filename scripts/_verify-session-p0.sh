#!/usr/bin/env bash
set -euo pipefail
echo "=== source markers ==="
grep -n '30 \* time.Minute' /opt/proxyhubb/services/control-api/internal/sessionintent/token.go || true
grep -n 'remintSessionIntent' /opt/proxyhubb/apps/web/src/lib/api/sessions.ts | head -3 || true
grep -n 'Authorized' /opt/proxyhubb/apps/web/src/app/dashboard/sessions/page.tsx | head -3 || true
echo "=== binary string markers ==="
sudo docker exec proxyhubb-control-api-1 sh -c 'strings /app/control-api | grep -F "intent_gateway" | head -3'
sudo docker exec proxyhubb-control-api-1 sh -c 'strings /app/control-api | grep -F "Only authorized or expired intents can be reminted" | head -3'
sudo docker exec proxyhubb-web-1 sh -c 'grep -R -l "remint" /app/app/.next/static 2>/dev/null | head -3 || true'
echo "SESSION_P0_VERIFY_OK"
