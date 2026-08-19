#!/usr/bin/env bash
set -euo pipefail
echo -n api_started=
sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1
echo -n api_image=
sudo docker inspect -f '{{.Image}}' proxyhubb-control-api-1
echo -n edge_b_started=
sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-edge-gateway-b-1
echo -n edge_a_started=
sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-edge-gateway-a-1
echo -n api_cap=
sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_SESSION_CAPABILITY
echo -n api_mint=
sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT
echo -n listing=
sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_LISTING_COMMITMENT
echo -n edge_b_cap=
sudo docker exec proxyhubb-edge-gateway-b-1 printenv PROXYHUB_SESSION_CAPABILITY
echo -n edge_a_cap=
sudo docker exec proxyhubb-edge-gateway-a-1 printenv PROXYHUB_SESSION_CAPABILITY
echo -n slash_auto=
sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_GATEWAY_SLASH_AUTO || echo unset
echo -n slash_confirm=
sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_GATEWAY_SLASH_CONFIRM || echo unset
echo -n edge_b_issuer_n=
sudo docker exec proxyhubb-edge-gateway-b-1 printenv PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY | awk -F, '{print NF}'
sudo docker exec -i proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "SELECT slug, org_id, display_name FROM gateway_operators WHERE slug IN ('edge-ext','edge-org3') ORDER BY slug;"
