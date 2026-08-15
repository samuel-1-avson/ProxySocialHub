#!/usr/bin/env bash
set -euo pipefail
sed -i 's/\r$//' /tmp/ops-wave1-connect-e2e.sh /tmp/gcp-smoke-marketplace-escrow-buy.sh
cp /tmp/ops-wave1-connect-e2e.sh /opt/proxyhubb/scripts/
cp /tmp/gcp-smoke-marketplace-escrow-buy.sh /opt/proxyhubb/scripts/
cd /opt/proxyhubb
if [[ ! -s /tmp/smoke-funder.json ]]; then
  echo "FUNDER_MISSING"; exit 2
fi
echo "FUNDER_OK"
# Keep tunnel node alive during smoke cleanup
export REQUIRE_CONNECT=1
export HOLD_RELEASE=1
export SKIP_NODE_SOFT_DELETE=1
export NODE_ID=4b60f9e2-11dc-4240-a332-6ec9f3669379
export LISTING_ID=c1472dbc-dee3-407e-8fea-ec3ed42489ac
export ORACLE_KP=/tmp/smoke-funder.json
bash scripts/ops-wave1-connect-e2e.sh
