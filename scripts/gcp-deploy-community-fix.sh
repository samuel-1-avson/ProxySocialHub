#!/usr/bin/env bash
# Emergency deploy: Community IA + referrals + messages (web + control-api).
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
DEPLOY_TAR="${DEPLOY_TAR:?Set DEPLOY_TAR}"
DOCKER="${DOCKER:-docker}"

cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Extracting $DEPLOY_TAR"
tmpdir=$(mktemp -d)
tar -xzf "$DEPLOY_TAR" -C "$tmpdir"

if [[ -d "$tmpdir/web" ]]; then
  mkdir -p "$PROJECT_DIR/apps/web"
  cp -a "$tmpdir/web/." "$PROJECT_DIR/apps/web/"
fi
if [[ -d "$tmpdir/control-api" ]]; then
  mkdir -p "$PROJECT_DIR/services/control-api"
  cp -a "$tmpdir/control-api/." "$PROJECT_DIR/services/control-api/"
fi
rm -rf "$tmpdir"

# Strip CRLF from synced sources
find "$PROJECT_DIR/apps/web/src" "$PROJECT_DIR/services/control-api/internal" \
  -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.go' \) \
  -exec sed -i 's/\r$//' {} + 2>/dev/null || true

test -f "$PROJECT_DIR/apps/web/src/lib/referral.ts" || { echo "missing referral.ts" >&2; exit 1; }
test -f "$PROJECT_DIR/apps/web/src/app/community/messages/page.tsx" || { echo "missing messages page" >&2; exit 1; }
grep -q 'ProcessReferralSignup' "$PROJECT_DIR/services/control-api/internal/api/auth.go" \
  || { echo "auth.go missing referral wiring" >&2; exit 1; }
grep -q 'DISTINCT ON' "$PROJECT_DIR/services/control-api/internal/api/messaging.go" \
  || { echo "messaging.go missing batch query" >&2; exit 1; }
grep -q 'Inbox' "$PROJECT_DIR/apps/web/src/lib/navigation/nav.ts" \
  || { echo "nav.ts missing Inbox Messages icon" >&2; exit 1; }

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

cd "$PROJECT_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building control-api + web (emergency, no GHCR overlay)"
"${COMPOSE[@]}" build control-api web
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api web

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Waiting for healthy…"
for svc in control-api web; do
  ok=0
  for i in $(seq 1 72); do
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
    echo "$svc failed to become healthy" >&2
    "${COMPOSE[@]}" logs --tail=80 "$svc" || true
    exit 1
  fi
done

echo "=== verify ==="
curl -sS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health || true
curl -sS -o /dev/null -w "web_home=%{http_code}\n" http://127.0.0.1:3000/ || true
curl -sS -o /dev/null -w "web_forum=%{http_code}\n" http://127.0.0.1:3000/community/forum || true
curl -sS -o /dev/null -w "web_messages=%{http_code}\n" http://127.0.0.1:3000/community/messages || true
curl -sS -o /dev/null -w "web_map=%{http_code}\n" http://127.0.0.1:3000/marketplace/map || true

# Presence-only checks in built JS (no secrets)
NAV_HAS_INBOX=$(sudo docker exec proxyhubb-web-1 sh -c 'grep -R -l "community/messages" /app/app/.next/static 2>/dev/null | head -1' || true)
echo "BUNDLE_MESSAGES_ROUTE=${NAV_HAS_INBOX:-none}"
API_HAS_REF=$(sudo docker exec proxyhubb-control-api-1 sh -c 'strings /app/control-api 2>/dev/null | grep -c ProcessReferralSignup || true')
echo "API_HAS_ProcessReferralSignup=${API_HAS_REF:-0}"

echo "COMMUNITY_DEPLOY_DONE"
