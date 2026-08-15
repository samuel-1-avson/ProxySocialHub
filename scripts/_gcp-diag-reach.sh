#!/usr/bin/env bash
set -euo pipefail
ufw status 2>/dev/null || echo no_ufw
timeout 3 bash -c 'echo >/dev/tcp/127.0.0.1/3128' && echo local3128_ok || echo local3128_fail
timeout 3 bash -c 'echo >/dev/tcp/35.255.62.196/3128' && echo hairpin3128_ok || echo hairpin3128_fail
timeout 3 bash -c 'echo >/dev/tcp/35.255.62.196/8090' && echo hairpin8090_ok || echo hairpin8090_fail
grep -E '^(PROVIDER_TUNNEL_PUBLIC_ADDR|PROVIDER_PUBLIC_CONTROL_API_URL|PROVIDER_SIGNATURE_MODE)=' /opt/proxyhubb/.env || true
echo DONE
