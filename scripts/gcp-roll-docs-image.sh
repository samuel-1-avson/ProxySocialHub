#!/usr/bin/env bash
# Roll only Docs from an archive built for the exact source revision.
set -euo pipefail
: "${EXPECTED_REVISION:?Set the exact source revision}"
[[ "$EXPECTED_REVISION" =~ ^[a-f0-9]{40}$ ]] || exit 2
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
archive="/tmp/proxyhubb-docs-$EXPECTED_REVISION.tar"
[[ -s "$archive" && ! -L "$archive" ]]
cd "$PROJECT_DIR"
compose=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.gcp-images.yml)
old_container=$("${compose[@]}" ps -q docs)
[[ -n "$old_container" ]]
old_image=$(docker inspect "$old_container" --format '{{.Image}}')
override=$(mktemp /tmp/proxyhubb-docs-image.XXXXXX.yml)
cleanup() { rm -f "$override" "$archive" "/tmp/proxyhubb-docs-$EXPECTED_REVISION.sh"; }
trap cleanup EXIT
docker load --input "$archive"
image=$(docker image ls --filter "label=org.opencontainers.image.revision=$EXPECTED_REVISION" --format '{{.Repository}}:{{.Tag}}' | grep -E '^ghcr\.io/[^/]+/docs:[A-Za-z0-9_.-]+$' | head -n 1)
[[ -n "$image" ]]
actual=$(docker inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ "$actual" == "$EXPECTED_REVISION" ]]
local_image="proxyhubb-production/docs:$EXPECTED_REVISION"
docker tag "$image" "$local_image"
write_override() { printf 'services:\n  docs:\n    image: "%s"\n    pull_policy: never\n' "$1" > "$override"; }
rollback() {
  trap - ERR
  echo 'Docs rollout failed; restoring the previous image.' >&2
  write_override "$old_image"
  "${compose[@]}" -f "$override" up -d --no-deps --no-build --force-recreate docs
  exit 1
}
write_override "$local_image"
trap rollback ERR
"${compose[@]}" -f "$override" up -d --no-deps --no-build --force-recreate docs
healthy=false
for _ in $(seq 1 60); do
  container=$("${compose[@]}" -f "$override" ps -q docs)
  if [[ "$(docker inspect "$container" --format '{{.State.Health.Status}}')" == healthy ]]; then healthy=true; break; fi
  sleep 5
done
[[ "$healthy" == true ]]
curl --fail --max-time 30 --silent --output /dev/null http://127.0.0.1:3010/docs
curl --fail --max-time 30 --silent --output /dev/null "https://docs.proxyhubb.com/docs?release=$EXPECTED_REVISION"
trap - ERR
printf 'Docs live: revision=%s image=%s rollback_image=%s\n' "$actual" "$local_image" "$old_image"
