#!/usr/bin/env bash
# Deploy HB-01..04 patches into existing trees, rebuild control-api.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?Set DEPLOY_TAR}"
DOCKER="${DOCKER:-docker}"

cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extracting $DEPLOY_TAR"
tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"

if [[ -d "$tmpdir/control-api" ]]; then
  mkdir -p "$PROJECT_DIR/services/control-api"
  cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
fi
if [[ -d "$tmpdir/provider-node" ]]; then
  mkdir -p "$PROJECT_DIR/services/provider-node"
  cp -a "$tmpdir/provider-node/." "$PROJECT_DIR/services/provider-node/"
fi
if [[ -d "$tmpdir/scripts" ]]; then
  mkdir -p "$PROJECT_DIR/scripts"
  cp -a "$tmpdir/scripts/." "$PROJECT_DIR/scripts/"
fi
rm -rf "$tmpdir"

find "$PROJECT_DIR/services/control-api" "$PROJECT_DIR/services/provider-node" "$PROJECT_DIR/scripts" \
  -type f \( -name '*.go' -o -name '*.rs' -o -name '*.sh' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

grep -q 'last_api_heartbeat' "$PROJECT_DIR/services/provider-node/src/tunnel/heartbeat.rs"
grep -q 'lease_task' "$PROJECT_DIR/services/provider-node/src/tunnel/client.rs"
grep -q 'activateProviderListingDraftIfReady(providerID, canonicalNode.ID' \
  "$PROJECT_DIR/services/control-api/internal/api/gateway.go"
grep -q 'first heartbeat is sent as soon as' \
  "$PROJECT_DIR/services/control-api/internal/api/provider_readiness.go"

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building control-api"
"${COMPOSE[@]}" build control-api

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Recreating control-api"
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

ok=0
for i in $(seq 1 72); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' 2>/dev/null || true)
  echo "try=$i control-api $st"
  if echo "$st" | grep -qi healthy; then
    echo "control-api HEALTHY"
    ok=1
    break
  fi
  sleep 5
done
if [[ "$ok" != "1" ]]; then
  echo "control-api failed healthy" >&2
  "${COMPOSE[@]}" logs --tail=100 control-api || true
  exit 1
fi

curl -sS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health || true
grep -n 'activateProviderListingDraftIfReady(providerID' \
  "$PROJECT_DIR/services/control-api/internal/api/gateway.go" | head -3
echo "PROVIDER_HB_DEPLOY_DONE"
