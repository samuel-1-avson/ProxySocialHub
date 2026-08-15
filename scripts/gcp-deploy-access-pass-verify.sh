#!/usr/bin/env bash
# Deploy Access Pass tx verification fix (control-api + web subscriptions).
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
if [[ -d "$tmpdir/web" ]]; then
  mkdir -p "$PROJECT_DIR/apps/web"
  cp -a "$tmpdir/web/." "$PROJECT_DIR/apps/web/"
fi
rm -rf "$tmpdir"
find "$PROJECT_DIR/services/control-api/internal/solana" \
  "$PROJECT_DIR/apps/web/src/app/dashboard/subscriptions" \
  -type f \( -name '*.go' -o -name '*.tsx' -o -name '*.ts' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true
grep -q 'CommitmentConfirmed' "$PROJECT_DIR/services/control-api/internal/solana/client.go" \
  || { echo "client.go missing CommitmentConfirmed" >&2; exit 1; }
grep -q 'maxAttempts' "$PROJECT_DIR/services/control-api/internal/solana/client.go" \
  || { echo "client.go missing verify retry" >&2; exit 1; }
grep -q 'retryable' "$PROJECT_DIR/apps/web/src/app/dashboard/subscriptions/page.tsx" \
  || { echo "subscriptions page missing confirm retry" >&2; exit 1; }
echo ACCESS_PASS_VERIFY_OK
COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building control-api"
"${COMPOSE[@]}" build control-api
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Recreating control-api"
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
ok=0
for i in $(seq 1 120); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' 2>/dev/null || true)
  echo "try=$i control-api $st"
  if echo "$st" | grep -qi healthy; then echo control-api HEALTHY; ok=1; break; fi
  sleep 5
done
[[ "$ok" -eq 1 ]] || { echo "control-api not healthy" >&2; exit 1; }
export ALLOW_EMERGENCY_WEB_BUILD=1 PROJECT_DIR DOCKER
unset WEB_TAR
bash "$PROJECT_DIR/scripts/gcp-deploy-web-emergency-build.sh"
