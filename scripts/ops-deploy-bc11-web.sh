#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
install() { mkdir -p "$(dirname "$2")"; tr -d '\015' <"$1" >"$2"; echo "installed $2"; }
install /tmp/bc11/trustless-page.tsx apps/web/src/app/dashboard/trustless/page.tsx
install /tmp/bc11/dashboard-page.tsx apps/web/src/app/dashboard/page.tsx
install /tmp/bc11/nav.ts apps/web/src/lib/navigation/nav.ts
install /tmp/bc11/provider-page.tsx apps/web/src/app/dashboard/provider/page.tsx
grep -q 'not trustless ZK' apps/web/src/app/dashboard/trustless/page.tsx
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" build web
"${COMPOSE[@]}" up -d --no-deps --force-recreate web
curl -fsS -o /dev/null -w "web=%{http_code}\n" http://127.0.0.1:3000/ || true
echo BC11_WEB_DONE
