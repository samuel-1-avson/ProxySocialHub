#!/usr/bin/env bash
# Roll one immutable frontend image, retaining the existing runtime environment.
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
: "${WEB_IMAGE:?Set the published frontend image}"
: "${EXPECTED_REVISION:?Set the source commit SHA}"
[[ "$WEB_IMAGE" =~ ^ghcr\.io/[a-zA-Z0-9_.-]+/web:[a-zA-Z0-9_.-]+$ ]] || exit 2
[[ "$EXPECTED_REVISION" =~ ^[a-f0-9]{40}$ ]] || exit 2
cd "$PROJECT_DIR"
compose=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.gcp-images.yml)
old_container=$("${compose[@]}" ps -q web)
old_image=$(docker inspect "$old_container" --format '{{.Image}}')
override=$(mktemp /tmp/proxyhubb-web-image.XXXXXX.yml)
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
trap 'rm -f "$override"' EXIT
docker pull "$WEB_IMAGE"
actual_revision=$(docker inspect "$WEB_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ "$actual_revision" == "$EXPECTED_REVISION" ]]
write_override "$WEB_IMAGE"
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
printf 'Frontend live: image=%s revision=%s workspace_http=%s public_http=%s rollback_image=%s\n' "$WEB_IMAGE" "$actual_revision" "$code" "$public_code" "$old_image"
