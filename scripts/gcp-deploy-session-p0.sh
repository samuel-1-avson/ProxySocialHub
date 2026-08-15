#!/usr/bin/env bash
# Deploy session P0: remint, 30m TTL, Live Pulse intents, intent settle.
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

find "$PROJECT_DIR/services/control-api" "$PROJECT_DIR/apps/web" \
  -type f \( -name '*.go' -o -name '*.ts' -o -name '*.tsx' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

grep -q 'IssueWithID' "$PROJECT_DIR/services/control-api/internal/sessionintent/token.go"
grep -q '30 \* time.Minute' "$PROJECT_DIR/services/control-api/internal/sessionintent/token.go"
grep -q 'remintSessionIntent' "$PROJECT_DIR/services/control-api/internal/api/session_intent_remint.go"
grep -q 'SettleSessionIntent' "$PROJECT_DIR/services/control-api/internal/settlement/intent.go"
grep -q 'SessionIntentRouted' "$PROJECT_DIR/services/control-api/internal/api/session_stream.go"
grep -q 'remintSessionIntent' "$PROJECT_DIR/apps/web/src/lib/api/sessions.ts"
grep -q 'Authorized ≠ active path' "$PROJECT_DIR/apps/web/src/app/dashboard/sessions/page.tsx"
grep -q 'kind === "intent"' "$PROJECT_DIR/apps/web/src/components/SessionLiveCard.tsx"

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building control-api + web"
"${COMPOSE[@]}" build control-api web

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Recreating control-api + web"
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api web

for svc in control-api web; do
  ok=0
  for i in $(seq 1 90); do
    st=$("${COMPOSE[@]}" ps "$svc" --format '{{.Status}}' 2>/dev/null || true)
    echo "try=$i $svc $st"
    if echo "$st" | grep -qi healthy; then
      echo "$svc HEALTHY"
      ok=1
      break
    fi
    sleep 5
  done
  if [[ "$ok" != "1" ]]; then
    echo "$svc failed healthy" >&2
    "${COMPOSE[@]}" logs --tail=100 "$svc" || true
    exit 1
  fi
done

echo "=== verify ==="
curl -sS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health || true
curl -sS -o /dev/null -w "web_home=%{http_code}\n" http://127.0.0.1:3000/ || true
curl -sS -o /dev/null -w "web_sessions=%{http_code}\n" http://127.0.0.1:3000/dashboard/sessions || true
sudo docker exec proxyhubb-control-api-1 sh -c 'strings /app/control-api 2>/dev/null | grep -c SettleSessionIntent || true' | awk '{print "SettleSessionIntent_strings="$1}'
sudo docker exec proxyhubb-control-api-1 sh -c 'strings /app/control-api 2>/dev/null | grep -c remint || true' | awk '{print "remint_strings="$1}'
echo "SESSION_P0_DEPLOY_DONE"
