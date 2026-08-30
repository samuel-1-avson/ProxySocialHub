#!/usr/bin/env bash
# Profile honesty + GeoIP privacy + login device sessions + API-key admin lock.
# Never --remove-orphans. Never recreate edge-a.
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
CTR=proxyhubb-control-api-1
EDGE_A=proxyhubb-edge-gateway-a-1
STAMP="${ROLL_STAMP:-$(date -u +%Y%m%d-%H%M)}"
TAG="proxyhubb-control-api:pre-profile-settings-${STAMP}"
SRC="${PROFILE_API_SRC:-/tmp/profile-settings-api}"
cd "$ROOT"
API_COMPOSE=(-f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
[[ -f docker-compose.w6-host-a-private.yml ]] && API_COMPOSE+=(-f docker-compose.w6-host-a-private.yml)
[[ -f docker-compose.w10-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-observe.yml)
[[ -f docker-compose.w10-listing-observe.yml ]] && API_COMPOSE+=(-f docker-compose.w10-listing-observe.yml)
[[ -f docker-compose.w11-enforce.yml ]] && API_COMPOSE+=(-f docker-compose.w11-enforce.yml)

grep -q 'ToSelfProfile' "$SRC/profile.go"
grep -q 'validAvatarURL' "$SRC/profile_api.go"
grep -q 'recordLoginDeviceSession' "$SRC/user_security.go"
grep -q 'admin permission requires' "$SRC/apikeys.go"
grep -q 'getUserBadges' "$SRC/badges.go"

EDGE_A_STARTED_BEFORE=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
sudo docker tag proxyhubb-control-api "$TAG" || true

sync_one() {
  local src="$1" dest="$2"
  tr -d '\015' < "$src" | sudo tee "$dest" >/dev/null
  sudo sed -i 's/\r$//' "$dest"
}

sync_one "$SRC/profile.go" "$ROOT/services/control-api/internal/models/profile.go"
sync_one "$SRC/profile_api.go" "$ROOT/services/control-api/internal/api/profile.go"
sync_one "$SRC/badges.go" "$ROOT/services/control-api/internal/api/badges.go"
sync_one "$SRC/auth.go" "$ROOT/services/control-api/internal/api/auth.go"
sync_one "$SRC/user_security.go" "$ROOT/services/control-api/internal/api/user_security.go"
sync_one "$SRC/apikeys.go" "$ROOT/services/control-api/internal/api/apikeys.go"

sudo docker compose "${API_COMPOSE[@]}" build control-api
sudo docker compose "${API_COMPOSE[@]}" up -d --no-deps --force-recreate control-api
ok=0
for i in $(seq 1 40); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CTR" 2>/dev/null || echo missing)
  echo "try=$i health=$st"
  if [[ "$st" == "healthy" ]]; then ok=1; break; fi
  sleep 3
done
[[ "$ok" == "1" ]] || { echo "FAIL: control-api not healthy"; sudo docker logs --tail 80 "$CTR" || true; exit 2; }
EDGE_A_STARTED_AFTER=$(sudo docker inspect -f '{{.State.StartedAt}}' "$EDGE_A")
[[ "$EDGE_A_STARTED_BEFORE" == "$EDGE_A_STARTED_AFTER" ]] || { echo "FAIL: edge-a was recreated"; exit 2; }
echo PROFILE_SETTINGS_API_OK
echo rollback_tag="$TAG"
