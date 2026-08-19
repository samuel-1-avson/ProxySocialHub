#!/usr/bin/env bash
set -euo pipefail
echo '--- preflight ---'
sudo docker inspect -f 'id={{.Image}} created={{.Created}}' proxyhubb-control-api-1
sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_SESSION_CAPABILITY
sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_LISTING_COMMITMENT
sudo docker exec proxyhubb-control-api-1 printenv GATEWAY_OP_A_HOST_ID
sudo docker exec proxyhubb-control-api-1 printenv GATEWAY_OP_B_HOST_ID
sa=$(sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
sc=$(sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
echo "slash_auto=${sa:-unset}"
echo "slash_confirm=${sc:-unset}"
curl -fsS http://127.0.0.1:18080/health
echo
echo '--- kill-api ---'
CONFIRM_W10A_KILL_API=1 bash /tmp/w10a-kill.sh
echo '--- post ---'
curl -fsS http://127.0.0.1:18080/health
echo
sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_LISTING_COMMITMENT
sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_SESSION_CAPABILITY
