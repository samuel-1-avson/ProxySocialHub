#!/usr/bin/env bash
# Read-only inspect for the listing_commitment_sync shop-publish soak.
set -euo pipefail
echo "=== env ==="
sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_LISTING_COMMITMENT APP_ENV PROVIDER_SIGNATURE_MODE PROXYHUB_ALLOW_DEV_LISTING_SIGN 2>/dev/null || true
echo "=== provider_nodes ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c \
  "select id::text, user_id::text, left(coalesce(hotkey,''), 8) as hotkey8, length(coalesce(hotkey,'')) as hotkey_len, coalesce(gateway_node_id,'') as gw, status from provider_nodes order by last_seen_at desc nulls last limit 8;"
echo "=== listings ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c \
  "select id::text, seller_id::text, left(title, 32) as title, listing_offer_verified as offer_ok, listing_commitment_on_chain as on_chain, coalesce(listing_commitment_pda,'') as pda, status from proxy_listings order by updated_at desc nulls last limit 8;"
echo "=== provider containers / signing key present ==="
sudo docker ps --format '{{.Names}}' | grep -i provider || true
echo "host_env_signing_key_lines=$(sudo grep -c '^PROXYHUB_PROVIDER_SIGNING_KEY=.' /opt/proxyhubb/.env || true)"
