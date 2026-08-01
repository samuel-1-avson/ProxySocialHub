#!/bin/bash
# Drift recon: compare host checkout vs running web container.
# Prefer GHCR deploys (./scripts/gcp-deploy-web.sh). Host edits alone do not update production.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/lib/gcp-web-policy.sh
source "$SCRIPT_DIR/lib/gcp-web-policy.sh"

echo "=== policy ==="
echo "canonical_url=$PROXYHUBB_WEB_CANONICAL_URL"
echo "prefer: IMAGE_TAG=… ./scripts/gcp-deploy-web.sh"

echo "=== running image ==="
sudo docker inspect "$PROXYHUBB_WEB_CONTAINER" --format 'Image={{.Config.Image}} Created={{.Created}}' 2>/dev/null || echo "NO_CONTAINER"

echo "=== host layout markers ==="
grep -n "WalletBoundary\|SolanaWalletProvider\|Ghana" /opt/proxyhubb/apps/web/src/app/layout.tsx 2>/dev/null | head -20 || true
echo "=== features/wallet on host ==="
ls /opt/proxyhubb/apps/web/src/features/wallet/components 2>/dev/null | head -20 || echo MISSING_FEATURES
echo "=== WalletBoundary file ==="
test -f /opt/proxyhubb/apps/web/src/providers/WalletBoundary.tsx && echo HAS_BOUNDARY || echo NO_BOUNDARY
echo "=== container markers ==="
sudo docker exec "$PROXYHUBB_WEB_CONTAINER" sh -c 'grep -R -l "Settlement ledger" /app/app/.next/static/chunks 2>/dev/null | head -3 || echo NO_SETTLEMENT'
sudo docker exec "$PROXYHUBB_WEB_CONTAINER" sh -c 'grep -R -l "features/wallet" /app/app/.next/server 2>/dev/null | head -3 || echo NO_FEATURES_PATH'
sudo docker exec "$PROXYHUBB_WEB_CONTAINER" sh -c 'grep -R -l "WalletBoundary" /app/app/.next/server 2>/dev/null | head -3 || echo NO_WALLET_BOUNDARY'
echo "=== onboarding route ==="
curl -sS -o /dev/null -w 'onboarding=%{http_code}\n' http://127.0.0.1:3000/onboarding || true
curl -sS -o /dev/null -w 'root=%{http_code}\n' http://127.0.0.1:3000/ || true
echo "=== compose labels ==="
sudo docker inspect "$PROXYHUBB_WEB_CONTAINER" --format '{{json .Config.Labels}}' | head -c 800; echo
echo DONE
