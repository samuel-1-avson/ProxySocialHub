#!/usr/bin/env bash
# Emergency web deploy: marketplace map camera fix + sidebar Map link removal.
set -euo pipefail
cd /opt/proxyhubb

TAR="${WEB_TAR:-/tmp/map-reset-fix-web.tar.gz}"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extracting $TAR"
sudo tar -xzf "$TAR" -C /opt/proxyhubb

sudo find apps/web/src/components/map \
  apps/web/src/app/marketplace/map \
  apps/web/src/lib/navigation \
  -type f \( -name '*.ts' -o -name '*.tsx' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

test -f apps/web/src/components/map/GoogleProxyMapCanvas.tsx
grep -q 'mapOptionsRef' apps/web/src/components/map/GoogleProxyMapCanvas.tsx \
  || { echo "ERROR: mapOptionsRef missing — wrong bundle?" >&2; exit 1; }
grep -q 'activeRouteKeys: \["marketplaceMap"\]' apps/web/src/lib/navigation/nav.ts \
  || { echo "ERROR: Discover activeRouteKeys missing" >&2; exit 1; }
! grep -q 'navItem("marketplaceMap", "Map"' apps/web/src/lib/navigation/nav.ts \
  || { echo "ERROR: Market sidebar Map item still present" >&2; exit 1; }
echo SOURCE_OK

# Prefer GCP Secret Manager / API Keys as source of truth for Maps JS key
if [[ -f scripts/gcp-sync-google-maps-key.sh ]]; then
  echo "Syncing Google Maps API key from GCP…"
  PROJECT_DIR=/opt/proxyhubb bash scripts/gcp-sync-google-maps-key.sh \
    || echo "WARN: GCP Maps key sync failed; falling back to existing .env" >&2
fi

if ! grep -qE '^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=.+' .env; then
  echo "ERROR: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set in .env" >&2
  exit 1
fi
echo GOOGLE_MAPS_KEY=present
if grep -qE '^NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=.+' .env; then
  echo GOOGLE_MAPS_MAP_ID=present
else
  echo GOOGLE_MAPS_MAP_ID=unset
fi

COMPOSE=(sudo docker compose
  -f /opt/proxyhubb/docker-compose.yml
  -f /opt/proxyhubb/docker-compose.testnet.yml
  -f /opt/proxyhubb/docker-compose.gcp-testnet.yml
)

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building web"
"${COMPOSE[@]}" build web
"${COMPOSE[@]}" up -d --no-deps --force-recreate web

for i in $(seq 1 72); do
  st=$("${COMPOSE[@]}" ps web --format '{{.Status}}' 2>/dev/null || true)
  echo "try=$i $st"
  echo "$st" | grep -qi healthy && echo HEALTHY && break
  sleep 5
done

for path in / /marketplace /marketplace/map; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000$path" || echo fail)
  echo "local$path=$code"
done

if [[ -x scripts/_verify-gmaps-web.sh ]]; then
  bash scripts/_verify-gmaps-web.sh || true
fi

echo DEPLOY_MAP_RESET_FIX_DONE
