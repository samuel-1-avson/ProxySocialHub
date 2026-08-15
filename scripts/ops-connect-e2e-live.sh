#!/usr/bin/env bash
# Point smoke listing at the edge-registered provider_node DB id, then run CONNECT e2e.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
LISTING_ID="${LISTING_ID:-c1472dbc-dee3-407e-8fea-ec3ed42489ac}"
# Edge registers gateway_node_id node_<user> → DB provider_nodes id:
NODE_ID="${NODE_ID:-4b60f9e2-11dc-4240-a332-6ec9f3669379}"
SELLER="${SELLER:-b77e84c9-0e85-4f23-afc0-581cd561c216}"

psql() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 "$@"; }

echo "=== align listing to edge-registered node $NODE_ID ==="
psql -c "UPDATE provider_nodes SET deleted_at=NULL, status='online', is_healthy=true, last_seen_at=NOW(), updated_at=NOW() WHERE id='$NODE_ID';"
psql -c "UPDATE proxy_listings SET provider_node_id='$NODE_ID', status='active', updated_at=NOW() WHERE id='$LISTING_ID';"
psql -c "SELECT id, status, is_healthy, deleted_at IS NOT NULL AS deleted, gateway_node_id FROM provider_nodes WHERE id='$NODE_ID';"
psql -c "SELECT id, status, provider_node_id, seller_id FROM proxy_listings WHERE id='$LISTING_ID';"

echo "=== provider tunnel still up? ==="
docker logs proxyhubb-provider-node --tail 15 2>&1 | grep -iE 'tunnel|handshake|error|auth' || true

# Stage funder if missing
if [[ ! -s /tmp/smoke-funder.json ]]; then
  echo "WARN: /tmp/smoke-funder.json missing — escrow funding may fail"
fi

export LISTING_ID NODE_ID
export HOLD_RELEASE=1
export REQUIRE_CONNECT=1
export ORACLE_KP="${ORACLE_KP:-/tmp/smoke-funder.json}"
export SKIP_NODE_SOFT_DELETE=1

# Patch cleanup soft-delete of live node: run smoke with NODE_ID but prevent soft-delete via env if supported.
# If smoke always soft-deletes NODE_ID, override cleanup by using a copy of smoke with soft-delete skipped.
if grep -q 'SKIP_NODE_SOFT_DELETE' scripts/gcp-smoke-marketplace-escrow-buy.sh 2>/dev/null; then
  :
else
  # Temporarily neutralize soft-delete of the live tunnel node in cleanup by pointing NODE_ID
  # revive/cleanup at a throwaway offline node while listing uses the live one.
  # Safer: sed a one-shot wrapper.
  sed 's/UPDATE provider_nodes SET deleted_at=NOW().*WHERE id='\''\$NODE_ID'\''.*/echo "skip soft-delete NODE_ID=\$NODE_ID (SKIP_NODE_SOFT_DELETE)";/' \
    scripts/gcp-smoke-marketplace-escrow-buy.sh > /tmp/smoke-connect-nosoftdel.sh || cp scripts/gcp-smoke-marketplace-escrow-buy.sh /tmp/smoke-connect-nosoftdel.sh
fi

echo "=== run CONNECT e2e REQUIRE_CONNECT=1 NODE_ID=$NODE_ID ==="
set +e
if [[ -f /tmp/smoke-connect-nosoftdel.sh ]]; then
  bash /tmp/smoke-connect-nosoftdel.sh
else
  bash scripts/ops-wave1-connect-e2e.sh
fi
RC=$?
set -e
echo "CONNECT_E2E_RC=$RC"
exit "$RC"
