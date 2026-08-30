#!/usr/bin/env bash
# Profile honesty UI, identity save/avatar, quotas, 2FA disable, GDPR export.
# Never --remove-orphans. Never recreate edge-a or control-api.
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
WEB_CTR=proxyhubb-web-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-web:pre-profile-settings-${STAMP}"
SRC="${PROFILE_WEB_SRC:-/tmp/profile-settings-web}"
cd "$ROOT"
API_COMPOSE=(-f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
[[ -f docker-compose.w6-host-a-private.yml ]] && API_COMPOSE+=(-f docker-compose.w6-host-a-private.yml)
[[ -f docker-compose.w10-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-observe.yml)
[[ -f docker-compose.w10-listing-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-listing-observe.yml)
[[ -f docker-compose.w11-enforce.yml ]] && API_COMPOSE+=(-f docker-compose.w11-enforce.yml)

grep -q 'Edit profile' "$SRC/ProfileView.tsx"
grep -q 'fileToAvatarDataUrl' "$SRC/identity-page.tsx"
grep -q 'getDailyUsage' "$SRC/account-page.tsx"
grep -q 'Download my data' "$SRC/DeleteAccountPanel.tsx"
grep -q 'Authenticator or backup code' "$SRC/security-page.tsx"
grep -q 'optionalAuthGet' "$SRC/profile.ts"
grep -q 'accountTierLabel' "$SRC/account-tier.ts"
grep -q 'getUserBadges' "$SRC/badges.ts"

EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
API_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
sudo docker tag proxyhubb-web "$TAG" || true

sync_one() {
  local src="$1" dest="$2"
  sudo mkdir -p "$(dirname "$dest")"
  tr -d '\015' < "$src" | sudo tee "$dest" >/dev/null
  sudo sed -i 's/\r$//' "$dest"
}

sync_one "$SRC/ProfileView.tsx" "$ROOT/apps/web/src/components/ProfileView.tsx"
sync_one "$SRC/utils.ts" "$ROOT/apps/web/src/lib/utils.ts"
sync_one "$SRC/account-tier.ts" "$ROOT/apps/web/src/lib/account-tier.ts"
sync_one "$SRC/profile.ts" "$ROOT/apps/web/src/lib/api/profile.ts"
sync_one "$SRC/client.ts" "$ROOT/apps/web/src/lib/api/client.ts"
sync_one "$SRC/badges.ts" "$ROOT/apps/web/src/lib/api/badges.ts"
sync_one "$SRC/profile-services.ts" "$ROOT/apps/web/src/lib/services/profile.ts"
sync_one "$SRC/social-api.ts" "$ROOT/apps/web/src/lib/social-api.ts"
sync_one "$SRC/settings-layout.tsx" "$ROOT/apps/web/src/app/dashboard/settings/layout.tsx"
sync_one "$SRC/identity-page.tsx" "$ROOT/apps/web/src/app/dashboard/settings/identity/page.tsx"
sync_one "$SRC/account-page.tsx" "$ROOT/apps/web/src/app/dashboard/settings/account/page.tsx"
sync_one "$SRC/devices-page.tsx" "$ROOT/apps/web/src/app/dashboard/settings/devices/page.tsx"
sync_one "$SRC/security-page.tsx" "$ROOT/apps/web/src/app/dashboard/settings/security/page.tsx"
sync_one "$SRC/DeleteAccountPanel.tsx" "$ROOT/apps/web/src/components/settings/DeleteAccountPanel.tsx"

sudo docker compose "${API_COMPOSE[@]}" build web
sudo docker compose "${API_COMPOSE[@]}" up -d --no-deps --force-recreate web
ok=0
for i in $(seq 1 60); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$WEB_CTR" 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  if [[ "$st" == "healthy" ]]; then ok=1; break; fi
  sleep 3
done
[[ "$ok" == "1" ]] || { echo "FAIL: web not healthy"; sudo docker logs --tail 80 "$WEB_CTR" || true; exit 2; }
EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }
API_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
[[ "$API_STARTED_BEFORE" == "$API_STARTED_AFTER" ]] || { echo "FAIL: control-api was recreated"; exit 2; }
echo PROFILE_SETTINGS_WEB_OK
echo rollback_tag="$TAG"
