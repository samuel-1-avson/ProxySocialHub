#!/usr/bin/env bash
# Deploy treasury public page fix (control-api + web).
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?}"
DOCKER="${DOCKER:-docker}"
cd "$PROJECT_DIR"
tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"
[[ -d "$tmpdir/control-api" ]] && cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
[[ -d "$tmpdir/web" ]] && cp -a "$tmpdir/web/." "$PROJECT_DIR/apps/web/"
[[ -d "$tmpdir/scripts" ]] && cp -a "$tmpdir/scripts/." "$PROJECT_DIR/scripts/"
rm -rf "$tmpdir"
find "$PROJECT_DIR/services/control-api" "$PROJECT_DIR/apps/web" "$PROJECT_DIR/scripts" \
  -type f \( -name '*.go' -o -name '*.ts' -o -name '*.tsx' -o -name '*.sh' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true
grep -q 'BalanceUnavailable' "$PROJECT_DIR/services/control-api/internal/treasury/treasury_manager.go"
grep -q 'balance_unavailable' "$PROJECT_DIR/apps/web/src/lib/api/treasury.ts"
grep -q 'balanceLabel' "$PROJECT_DIR/apps/web/src/app/treasury/page.tsx"
echo SOURCES_OK
COMPOSE=("$DOCKER" compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
for i in $(seq 1 48); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i $st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done
echo "$st" | grep -qi healthy
export ALLOW_EMERGENCY_WEB_BUILD=1 PROJECT_DIR DOCKER
unset WEB_TAR DEPLOY_TAR
bash "$PROJECT_DIR/scripts/gcp-deploy-web-emergency-build.sh"
echo '=== sample public treasury ==='
curl -sS http://127.0.0.1:18080/v1/treasury/public | head -c 1200; echo
echo TREASURY_UI_FIX_DONE

