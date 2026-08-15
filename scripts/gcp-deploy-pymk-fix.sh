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
find "$PROJECT_DIR/apps/web/src/components" -name 'PeopleYouMayKnow.tsx' -o -name 'FriendButton.tsx' | while read -r f; do sed -i 's/\r$//' "$f"; done
grep -q 'Do NOT call onStatusChange here' "$PROJECT_DIR/apps/web/src/components/FriendButton.tsx"
grep -q 'soft refresh' "$PROJECT_DIR/apps/web/src/components/PeopleYouMayKnow.tsx" || grep -q 'soft:' "$PROJECT_DIR/apps/web/src/components/PeopleYouMayKnow.tsx"
echo PYMK_FIX_OK
export ALLOW_EMERGENCY_WEB_BUILD=1 PROJECT_DIR DOCKER
unset WEB_TAR
bash "$PROJECT_DIR/scripts/gcp-deploy-web-emergency-build.sh"
