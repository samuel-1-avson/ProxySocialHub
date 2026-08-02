#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
sudo docker ps --filter name=proxyhubb-web-1 --format '{{.Names}} {{.Status}} {{.Image}}'
echo "MAP_HTTP=$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/marketplace/map)"
# Presence only — do not print secret values
if sudo docker exec proxyhubb-web-1 printenv NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 2>/dev/null | grep -q '.'; then
  echo 'KEY_BAKED=yes'
else
  echo 'KEY_BAKED=no'
fi
if sudo docker exec proxyhubb-web-1 printenv NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID 2>/dev/null | grep -q '.'; then
  echo 'MAP_ID_BAKED=yes'
else
  echo 'MAP_ID_BAKED=no'
fi
BUNDLE=$(sudo docker exec proxyhubb-web-1 sh -c 'grep -R -l maps.googleapis.com /app/app/.next/static 2>/dev/null | head -1' || true)
echo "BUNDLE_GMAPS=${BUNDLE:-none}"
