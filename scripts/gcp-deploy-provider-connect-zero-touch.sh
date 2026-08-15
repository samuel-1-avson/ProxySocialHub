#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
cd "$PROJECT_DIR"

echo "==> Apply control-api patch"
tmp=$(mktemp -d)
tar -xzf /tmp/provider-connect-api-20260806-214516.tar.gz -C "$tmp"
cp -a "$tmp/control-api/." "$PROJECT_DIR/services/control-api/"
find "$PROJECT_DIR/services/control-api/internal/api" -type f \( -name 'provider_token.go' -o -name 'provider_nodes.go' \) -exec sed -i 's/\r$//' {} +
grep -q 'node_id' "$PROJECT_DIR/services/control-api/internal/api/provider_token.go"
grep -q 'sanitizeProviderTunnelAddr' "$PROJECT_DIR/services/control-api/internal/api/provider_nodes.go"
echo API_SOURCE_OK

echo "==> Rebuild control-api"
docker compose -f docker-compose.yml -f docker-compose.gcp-testnet.yml build control-api
docker compose -f docker-compose.yml -f docker-compose.gcp-testnet.yml up -d --no-deps --force-recreate control-api
for i in $(seq 1 40); do
  st=$(docker compose -f docker-compose.yml -f docker-compose.gcp-testnet.yml ps control-api --format '{{.Status}}' || true)
  echo "try=$i $st"
  if echo "$st" | grep -qi healthy; then
    echo CONTROL_API_HEALTHY
    break
  fi
  sleep 5
done

echo "==> Apply web patch"
tmpw=$(mktemp -d)
tar -xzf /tmp/provider-connect-web-20260806-214516.tar.gz -C "$tmpw"
mkdir -p \
  "$PROJECT_DIR/apps/web/src/lib" \
  "$PROJECT_DIR/apps/web/src/components/provider" \
  "$PROJECT_DIR/apps/web/src/lib/api" \
  "$PROJECT_DIR/apps/web/src/app/dashboard/provider/setup"
cp -a "$tmpw/web/src/lib/provider-config.ts" "$PROJECT_DIR/apps/web/src/lib/"
cp -a "$tmpw/web/src/components/provider/ProviderNodeConnectPanel.tsx" "$PROJECT_DIR/apps/web/src/components/provider/"
cp -a "$tmpw/web/src/lib/api/provider.ts" "$PROJECT_DIR/apps/web/src/lib/api/"
cp -a "$tmpw/web/src/app/dashboard/provider/setup/page.tsx" "$PROJECT_DIR/apps/web/src/app/dashboard/provider/setup/"
find "$PROJECT_DIR/apps/web/src" -type f \( -name 'provider-config.ts' -o -name 'ProviderNodeConnectPanel.tsx' \) -exec sed -i 's/\r$//' {} +
grep -q 'buildWindowsInstallScript' "$PROJECT_DIR/apps/web/src/lib/provider-config.ts"
grep -q 'buildJoinCommand' "$PROJECT_DIR/apps/web/src/lib/provider-config.ts"
echo WEB_SOURCE_OK

echo "==> Emergency web rebuild"
export ALLOW_EMERGENCY_WEB_BUILD=1 PROJECT_DIR DOCKER=docker
bash "$PROJECT_DIR/scripts/gcp-deploy-web-emergency-build.sh"

# Ensure tunnel public addr is hostname (not IP)
if docker compose -f docker-compose.yml -f docker-compose.gcp-testnet.yml exec -T control-api printenv PROVIDER_TUNNEL_PUBLIC_ADDR 2>/dev/null | grep -E '^[0-9]+\.'; then
  echo "WARN: PROVIDER_TUNNEL_PUBLIC_ADDR looks like an IP — connect sanitize will rewrite to proxy.proxyhubb.com"
fi
docker compose -f docker-compose.yml -f docker-compose.gcp-testnet.yml exec -T control-api printenv PROVIDER_TUNNEL_PUBLIC_ADDR PROVIDER_PUBLIC_CONTROL_API_URL || true
echo DEPLOY_DONE
