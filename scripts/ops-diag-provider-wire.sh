#!/usr/bin/env bash
# Diagnose provider-node identity vs marketplace smoke NODE_ID/LISTING_ID.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
SMOKE_NODE="${SMOKE_NODE:-9f71b93c-27b0-4c73-92b5-a73526e48ced}"
SMOKE_LISTING="${SMOKE_LISTING:-c1472dbc-dee3-407e-8fea-ec3ed42489ac}"
SELLER="${SELLER:-b77e84c9-0e85-4f23-afc0-581cd561c216}"

psql() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 "$@"; }

echo "=== provider-node container ==="
docker inspect -f 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{end}}' proxyhubb-provider-node 2>/dev/null || echo missing
echo "=== provider logs (tunnel/auth) ==="
docker logs proxyhubb-provider-node --tail 80 2>&1 | grep -iE 'tunnel|connected|error|auth|node|register|heartbeat|quic|yamux|fail' | tail -40 || docker logs proxyhubb-provider-node --tail 40 2>&1 || true

echo "=== provider.toml / env hints (redacted) ==="
grep -E '^(node_id|provider_id|user_id|api_url|gateway)' config/docker/provider.toml 2>/dev/null || true
grep -E '^[A-Z]' config/docker/provider.compose.env 2>/dev/null | sed 's/=.*/=***/' || true

echo "=== smoke node/listing ==="
psql -c "SELECT id, user_id, status, is_healthy, deleted_at IS NOT NULL AS deleted, left(coalesce(hotkey,''),20) AS hotkey FROM provider_nodes WHERE id='$SMOKE_NODE';"
psql -c "SELECT id, status, provider_node_id, user_id FROM proxy_listings WHERE id='$SMOKE_LISTING';" 2>/dev/null || \
psql -c "SELECT id, status, node_id, user_id FROM proxy_listings WHERE id='$SMOKE_LISTING';" 2>/dev/null || true

echo "=== recent provider_nodes for seller ==="
psql -c "SELECT id::text, status, is_healthy, deleted_at IS NOT NULL AS deleted, last_seen_at, left(coalesce(hotkey,''),24) AS hotkey FROM provider_nodes WHERE user_id='$SELLER' ORDER BY last_seen_at DESC NULLS LAST LIMIT 10;"

echo "=== nodes mirror ==="
psql -c "SELECT id::text, provider_node_id::text, status, is_healthy, deleted_at IS NOT NULL AS deleted FROM nodes WHERE provider_node_id='$SMOKE_NODE' OR user_id='$SELLER' ORDER BY updated_at DESC NULLS LAST LIMIT 10;" 2>/dev/null || true

echo "=== edge recent provider connects ==="
docker logs proxyhubb-edge-gateway-1 --tail 100 2>&1 | grep -iE 'provider|tunnel|peer|yamux|quic|session' | tail -30 || true

echo PROVIDER_WIRE_DIAG_DONE
