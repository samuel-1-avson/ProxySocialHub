#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
WEB_TAR="${WEB_TAR:?Set WEB_TAR}"
DOCKER="${DOCKER:-docker}"

cd "$PROJECT_DIR"
tmpdir=$(mktemp -d)
tar -xzf "$WEB_TAR" -C "$tmpdir"
cp -a "$tmpdir/web/." "$PROJECT_DIR/apps/web/"
rm -rf "$tmpdir"
find "$PROJECT_DIR/apps/web/src/components" -name 'QuickMessageModal.tsx' -exec sed -i 's/\r$//' {} +

grep -q 'FlaskConical' "$PROJECT_DIR/apps/web/src/components/QuickMessageModal.tsx" \
  || { echo "QuickMessageModal missing Lucide icons" >&2; exit 1; }
! grep -qE '🌐|🔒|🎮|📱|📈|🧪|📋' "$PROJECT_DIR/apps/web/src/components/QuickMessageModal.tsx" \
  || { echo "QuickMessageModal still has emojis" >&2; exit 1; }

COMPOSE=(
  "$DOCKER" compose
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.testnet.yml"
  -f "$PROJECT_DIR/docker-compose.gcp-testnet.yml"
)

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Building web"
"${COMPOSE[@]}" build web
"${COMPOSE[@]}" up -d --no-deps --force-recreate web

for i in $(seq 1 60); do
  st=$("${COMPOSE[@]}" ps web --format '{{.Status}}' 2>/dev/null || true)
  echo "try=$i $st"
  if echo "$st" | grep -qi healthy; then
    echo HEALTHY
    break
  fi
  sleep 5
done

curl -sS -o /dev/null -w "web_home=%{http_code}\n" http://127.0.0.1:3000/ || true
echo "QUICK_MESSAGE_ICONS_DEPLOY_DONE"
