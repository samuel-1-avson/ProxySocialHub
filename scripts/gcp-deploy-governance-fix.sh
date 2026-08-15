#!/usr/bin/env bash
# Deploy governance privacy/custody fixes: migrations + control-api + web.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?Set DEPLOY_TAR to the uploaded tarball}"
DOCKER="${DOCKER:-docker}"

cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extracting $DEPLOY_TAR"
tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"

if [[ -d "$tmpdir/migrations" ]]; then
  mkdir -p "$PROJECT_DIR/migrations"
  cp -a "$tmpdir/migrations/." "$PROJECT_DIR/migrations/"
fi
if [[ -d "$tmpdir/control-api" ]]; then
  mkdir -p "$PROJECT_DIR/services/control-api"
  cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
fi
if [[ -d "$tmpdir/web" ]]; then
  mkdir -p "$PROJECT_DIR/apps/web"
  cp -a "$tmpdir/web/." "$PROJECT_DIR/apps/web/"
fi
if [[ -f "$tmpdir/scripts/gcp-deploy-governance-fix.sh" ]]; then
  cp -a "$tmpdir/scripts/gcp-deploy-governance-fix.sh" "$PROJECT_DIR/scripts/gcp-deploy-governance-fix.sh"
fi
rm -rf "$tmpdir"

find "$PROJECT_DIR/services/control-api" \
  "$PROJECT_DIR/apps/web/src/app/governance" \
  "$PROJECT_DIR/apps/web/src/app/treasury" \
  "$PROJECT_DIR/apps/web/src/lib/services" \
  "$PROJECT_DIR/migrations" \
  -type f \( -name '*.go' -o -name '*.ts' -o -name '*.tsx' -o -name '*.sql' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

test -f "$PROJECT_DIR/migrations/000130_governance_executor_tables.up.sql"
grep -q 'governanceEndSlot' "$PROJECT_DIR/services/control-api/internal/api/governance.go"
grep -q 'ErrTreasuryAwaitingCustody' "$PROJECT_DIR/services/control-api/internal/governance/executor.go"
grep -q 'pending_custody' "$PROJECT_DIR/services/control-api/internal/governance/executor.go"
grep -q 'finalizeProposal' "$PROJECT_DIR/apps/web/src/lib/services/governance.ts"
grep -q '1 wallet = 1 vote' "$PROJECT_DIR/apps/web/src/app/governance/page.tsx"
echo HAS_GOVERNANCE_FIX

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building db-migrate + control-api"
"${COMPOSE[@]}" build db-migrate control-api

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running db-migrate (000130)"
"${COMPOSE[@]}" run --rm --no-deps db-migrate

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Recreating control-api"
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

ok=0
for i in $(seq 1 120); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' 2>/dev/null || true)
  echo "try=$i control-api $st"
  if echo "$st" | grep -qi healthy; then
    echo control-api HEALTHY
    ok=1
    break
  fi
  sleep 5
done
[[ "$ok" -eq 1 ]] || { echo "control-api not healthy" >&2; exit 1; }

export ALLOW_EMERGENCY_WEB_BUILD=1
export PROJECT_DIR DOCKER
unset DEPLOY_TAR WEB_TAR
bash "$PROJECT_DIR/scripts/gcp-deploy-web-emergency-build.sh"

echo "=== verify ==="
curl -sS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health || true
curl -sS -o /tmp/gov-ready.json -w "gov_ready=%{http_code}\n" http://127.0.0.1:8080/v1/governance/execution-readiness || true
python3 - <<'PY'
import json
try:
  d=json.load(open("/tmp/gov-ready.json"))
  ge=d.get("governance_execution") or d
  print("ready", ge.get("ready"), "status", ge.get("status"), "msg", (ge.get("message") or "")[:120])
except Exception as e:
  print("ready_parse_err", e)
PY

"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT to_regclass('public.treasury_transactions') AS treasury_transactions,
          to_regclass('public.protocol_parameters') AS protocol_parameters,
          to_regclass('public.parameter_audits') AS parameter_audits,
          to_regclass('public.slashing_events') AS slashing_events,
          to_regclass('public.pending_upgrades') AS pending_upgrades;" \
  || true

"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='governance_proposals' AND column_name='onchain_pda';" \
  || true

if sudo docker exec proxyhubb-control-api-1 sh -c 'strings /app/control-api 2>/dev/null | grep -q "pending_custody\|governanceEndSlot\|Treasury auto-spend disabled"'; then
  echo BUNDLE_HAS_GOVERNANCE_FIX
else
  echo WARN_BUNDLE_MARKER_NOT_FOUND
fi

echo GOVERNANCE_FIX_DEPLOY_DONE
