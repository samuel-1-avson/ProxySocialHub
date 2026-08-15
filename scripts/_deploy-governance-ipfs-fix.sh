#!/usr/bin/env bash
# Fix governance "Failed to upload to decentralized storage" on gcp-testnet.
# Deploys IPFS stub/fallback + enables GOVERNANCE_IPFS_STUB=1.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

sed -i 's/\r$//' /tmp/ipfs_client.go /tmp/governance_api.go /tmp/docker-compose.yml 2>/dev/null || true
cp -f /tmp/ipfs_client.go services/control-api/internal/ipfs/client.go
cp -f /tmp/governance_api.go services/control-api/internal/api/governance.go
# Only replace compose if uploaded (optional)
if [[ -f /tmp/docker-compose.yml ]]; then
  cp -f /tmp/docker-compose.yml docker-compose.yml
fi

if grep -q '^GOVERNANCE_IPFS_STUB=' .env 2>/dev/null; then
  sed -i 's/^GOVERNANCE_IPFS_STUB=.*/GOVERNANCE_IPFS_STUB=1/' .env
else
  echo 'GOVERNANCE_IPFS_STUB=1' >> .env
fi

bash scripts/ops-rebuild-control-api.sh
sleep 3
"${COMPOSE[@]}" exec -T control-api printenv GOVERNANCE_IPFS_STUB SOLANA_NETWORK APP_ENV | sed 's/\r$//' || true
echo GOVERNANCE_IPFS_FIX_DONE
