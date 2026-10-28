#!/usr/bin/env bash
# Roll one verified frontend image, retaining the production runtime settings.
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
: "${IMAGE_ARCHIVE:?Set the built frontend image archive}"
: "${EXPECTED_REVISION:?Set the source commit SHA}"
[[ "$EXPECTED_REVISION" =~ ^[a-f0-9]{40}$ ]] || exit 2
expected_archive="/tmp/proxyhubb-web-${EXPECTED_REVISION}.tar"
[[ "$IMAGE_ARCHIVE" == "$expected_archive" && -s "$IMAGE_ARCHIVE" ]] || exit 2
cd "$PROJECT_DIR"
compose=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.gcp-images.yml)
old_container=$("${compose[@]}" ps -q web)
[[ -n "$old_container" ]]
old_image=$(docker inspect "$old_container" --format '{{.Image}}')
[[ -n "$old_image" ]]
override=$(mktemp /tmp/proxyhubb-web-image.XXXXXX.yml)
cleanup() { rm -f "$override" "$IMAGE_ARCHIVE" "/tmp/proxyhubb-web-${EXPECTED_REVISION}.sh"; }
trap cleanup EXIT
docker load --input "$IMAGE_ARCHIVE"
new_image=$(docker image ls --filter "label=org.opencontainers.image.revision=$EXPECTED_REVISION" --format '{{.Repository}}:{{.Tag}}' | grep -E '^ghcr\.io/.+/web:[A-Za-z0-9_.-]+$' | head -n 1)
[[ -n "$new_image" ]]
actual_revision=$(docker inspect "$new_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ "$actual_revision" == "$EXPECTED_REVISION" ]]
local_image="proxyhubb-production/web:$EXPECTED_REVISION"
docker tag "$new_image" "$local_image"
write_override() {
  printf 'services:\n  web:\n    image: "%s"\n    pull_policy: never\n' "$1" > "$override"
}
rollback() {
  trap - ERR
  echo 'Frontend rollout failed; restoring the previous frontend image.' >&2
  write_override "$old_image"
  "${compose[@]}" -f "$override" up -d --no-deps --no-build --force-recreate web
  exit 1
}
write_override "$local_image"
trap rollback ERR
"${compose[@]}" -f "$override" up -d --no-deps --no-build --force-recreate web
healthy=false
for i in $(seq 1 60); do
  container=$("${compose[@]}" -f "$override" ps -q web)
  health=$(docker inspect "$container" --format '{{.State.Health.Status}}')
  if [[ "$health" == healthy ]]; then healthy=true; break; fi
  sleep 5
done
[[ "$healthy" == true ]]
code=$(curl --max-time 20 -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/app)
[[ "$code" =~ ^(200|302|303|307|308)$ ]]
public_code=$(curl --max-time 30 -sS -o /dev/null -w '%{http_code}' "https://proxyhubb.com/app?release=$EXPECTED_REVISION")
[[ "$public_code" =~ ^(200|302|303|307|308)$ ]]
trap - ERR
printf 'Frontend live: revision=%s workspace_http=%s public_http=%s rollback_image=%s\n' "$actual_revision" "$code" "$public_code" "$old_image"
