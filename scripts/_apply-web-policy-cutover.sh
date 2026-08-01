#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
TAR=$(ls -1t /tmp/web-policy-cutover-*.tar.gz | head -1)
echo "Using $TAR"
sudo tar -xzf "$TAR" -C /opt/proxyhubb
sudo find scripts config/gcp -type f \( -name '*.sh' -o -name 'Caddyfile.example' \) -exec sed -i 's/\r$//' {} +
sudo chmod +x scripts/gcp-deploy-web.sh scripts/gcp-deploy-web-emergency-build.sh scripts/gcp-compose-pull-deploy.sh scripts/gcp-verify-web-deploy.sh scripts/_check-web-recon.sh scripts/_deploy-web-landing.sh scripts/_deploy-web-landing-v2.sh scripts/_deploy-web-landing-v3.sh scripts/lib/gcp-web-policy.sh

echo "=== backup Caddyfile ==="
sudo cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date -u +%Y%m%dT%H%M%SZ)"

echo "=== install Caddy redirects ==="
# Production block only — strip commented testnet template for live file
sudo awk '
  BEGIN { print "# Managed by web-policy-cutover — canonical apex proxyhubb.com" }
  /^# --- Testnet template/ { exit }
  { print }
' config/gcp/Caddyfile.example | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
echo CADDY_RELOADED

echo "=== fix .env FRONTEND_URL / CORS ==="
sudo cp -a .env ".env.bak.web-policy.$(date -u +%Y%m%dT%H%M%SZ)"
# Set FRONTEND_URL to apex
if grep -q '^FRONTEND_URL=' .env; then
  sudo sed -i 's|^FRONTEND_URL=.*|FRONTEND_URL=https://proxyhubb.com|' .env
else
  echo 'FRONTEND_URL=https://proxyhubb.com' | sudo tee -a .env >/dev/null
fi
# CORS: apex only after redirects (keep www/app briefly for in-flight clients)
if grep -q '^CORS_ORIGINS=' .env; then
  sudo sed -i 's|^CORS_ORIGINS=.*|CORS_ORIGINS=https://proxyhubb.com,https://www.proxyhubb.com,https://app.proxyhubb.com|' .env
else
  echo 'CORS_ORIGINS=https://proxyhubb.com,https://www.proxyhubb.com,https://app.proxyhubb.com' | sudo tee -a .env >/dev/null
fi
if grep -q '^APP_URL=' .env; then
  sudo sed -i 's|^APP_URL=.*|APP_URL=https://proxyhubb.com|' .env
else
  echo 'APP_URL=https://proxyhubb.com' | sudo tee -a .env >/dev/null
fi
grep -E '^(FRONTEND_URL|CORS_ORIGINS|APP_URL)=' .env

echo "=== recreate control-api to pick up CORS/FRONTEND_URL ==="
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
sleep 8
curl -sS -o /dev/null -w 'api_health=%{http_code}\n' http://127.0.0.1:8080/health || true

echo "=== verify redirects + web ==="
# Do not require GHCR — current prod web is local-built and newer than last landing roll
REQUIRE_REDIRECTS=1 REQUIRE_GHCR=0 ./scripts/gcp-verify-web-deploy.sh
echo CUTOVER_DONE