#!/usr/bin/env bash
# Release only the public Explorer from an already built, revision-checked image.
set -euo pipefail
: "${EXPECTED_REVISION:?Set the exact source revision}"
[[ "$EXPECTED_REVISION" =~ ^[a-f0-9]{40}$ ]] || exit 2
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
archive="/tmp/proxyhubb-explorer-$EXPECTED_REVISION.tar"
template="/tmp/proxyhubb-explorer-$EXPECTED_REVISION.yml"
[[ -s "$archive" && ! -L "$archive" && -f "$template" && ! -L "$template" ]]
[[ "$(hostname -s)" == proxyhubb-testnet ]]
cd "$PROJECT_DIR"
docker load --input "$archive"
image=$(docker image ls --filter "label=org.opencontainers.image.revision=$EXPECTED_REVISION" --format '{{.Repository}}:{{.Tag}}' | grep -E '^ghcr\.io/[^/]+/explorer:[A-Za-z0-9_.-]+$' | head -n 1)
[[ -n "$image" ]]
actual=$(docker inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ "$actual" == "$EXPECTED_REVISION" ]]
local_image="proxyhubb-production/explorer:$EXPECTED_REVISION"
docker tag "$image" "$local_image"
release_dir="$PROJECT_DIR/frontend-releases/explorer-$EXPECTED_REVISION"
mkdir -p "$release_dir"
sed "s|EXPLORER_IMAGE_PLACEHOLDER|$local_image|" "$template" > "$release_dir/compose.yml"
compose=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.gcp-images.yml -f "$release_dir/compose.yml")
container=$("${compose[@]}" ps -q explorer)
old_image=""
if [[ -n "$container" ]]; then old_image=$(docker inspect "$container" --format '{{.Image}}'); fi
cp /etc/caddy/Caddyfile "$release_dir/Caddyfile.before"
rollback() {
  trap - ERR
  cp "$release_dir/Caddyfile.before" /etc/caddy/Caddyfile
  systemctl reload caddy || true
  if [[ -n "$old_image" ]]; then
    printf 'services:\n  explorer:\n    image: "%s"\n    pull_policy: never\n' "$old_image" > "$release_dir/rollback.yml"
    "${compose[@]}" -f "$release_dir/rollback.yml" up -d --no-deps --no-build --force-recreate explorer
  else
    "${compose[@]}" stop explorer
  fi
  exit 1
}
trap rollback ERR
"${compose[@]}" up -d --no-deps --no-build --force-recreate explorer
healthy=false
for _ in $(seq 1 60); do
  container=$("${compose[@]}" ps -q explorer)
  if [[ -n "$container" ]] && [[ "$(docker inspect "$container" --format '{{.State.Health.Status}}')" == healthy ]]; then healthy=true; break; fi
  sleep 5
done
[[ "$healthy" == true ]]
curl --fail --max-time 30 --silent --output "$release_dir/health.json" http://127.0.0.1:4012/api/health
grep -q "$EXPECTED_REVISION" "$release_dir/health.json"
curl --fail --max-time 30 --silent --output /dev/null http://127.0.0.1:4012/about
curl --fail --max-time 30 --silent --output /dev/null 'http://127.0.0.1:4012/api/public?resource=metrics'
cp /etc/caddy/Caddyfile "$release_dir/Caddyfile.next"
if ! grep -qE '^[[:space:]]*explorer\.proxyhubb\.com[[:space:]]*\{' "$release_dir/Caddyfile.next"; then
  printf '\nexplorer.proxyhubb.com {\n  encode gzip\n  reverse_proxy 127.0.0.1:4012\n}\n' >> "$release_dir/Caddyfile.next"
fi
caddy validate --config "$release_dir/Caddyfile.next" --adapter caddyfile
install -m 644 "$release_dir/Caddyfile.next" /etc/caddy/Caddyfile
systemctl reload caddy
trap - ERR
printf 'Explorer staged: revision=%s image=%s rollback_image=%s\n' "$EXPECTED_REVISION" "$local_image" "${old_image:-none}"
rm -- "$archive"
