#!/usr/bin/env bash
# Roll one verified frontend image, retaining the production runtime settings.
set -euo pipefail
PROJECT_DIR="${PROJECT_DIR:-/opt/proxyhubb}"
: "${IMAGE_ARCHIVE:?Set the built frontend image archive}"
: "${EXPECTED_REVISION:?Set the source commit SHA}"
[[ "$EXPECTED_REVISION" =~ ^[a-f0-9]{40}$ ]] || exit 2
expected_archive="/tmp/proxyhubb-web-${EXPECTED_REVISION}.tar"
[[ "$IMAGE_ARCHIVE" == "$expected_archive" ]] || exit 2
[[ "${DEPLOY_PLAN_ONLY:-0}" == 1 || -s "$IMAGE_ARCHIVE" ]] || exit 2
cd "$PROJECT_DIR"
# Derive the exact live overlays. A fixed historical file list can silently drop
# current authentication/model settings or undo another production release.
old_container=$(docker ps -q --filter label=com.docker.compose.project=proxyhubb --filter label=com.docker.compose.service=web)
[[ -n "$old_container" && "$old_container" != *$'\n'* ]]
config_files=$(docker inspect "$old_container" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')
[[ -n "$config_files" ]]
compose=(docker compose --project-directory "$PROJECT_DIR" -p proxyhubb)
IFS=',' read -r -a live_files <<< "$config_files"
for file in "${live_files[@]}"; do
  [[ "$file" = /opt/proxyhubb/* || "$file" = /etc/proxyhubb/releases/* ]]
  [[ -f "$file" ]]
  compose+=(-f "$file")
done
old_image=$(docker inspect "$old_container" --format '{{.Image}}')
[[ -n "$old_image" ]]
# Compare only in memory and never print environment values. Resolve the live
# Compose inputs before touching the running service; fail if .env drift would
# change the account verifier or Meta credentials during a frontend-only roll.
fingerprint='import hashlib,json,sys; e=json.load(sys.stdin); print(hashlib.sha256(json.dumps({k:e.get(k) for k in ("API_URL","JWT_SECRET","MODEL_API_KEY")},sort_keys=True).encode()).hexdigest())'
old_settings=$(docker inspect "$old_container" --format '{{json .Config.Env}}' | python3 -c 'import json,sys; print(json.dumps(dict(v.split("=",1) for v in json.load(sys.stdin))))' | python3 -c "$fingerprint")
planned_settings=$("${compose[@]}" config --format json | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["services"]["web"].get("environment",{})))' | python3 -c "$fingerprint")
if [[ "$old_settings" != "$planned_settings" ]]; then
  echo 'Refusing frontend rollout: planned authentication/model settings differ from the live container.' >&2
  exit 1
fi
if [[ "${DEPLOY_PLAN_ONLY:-0}" == 1 ]]; then
  "${compose[@]}" config --quiet
  printf 'Frontend plan validated: overlays=%s old_image=%s revision=%s\n' "${#live_files[@]}" "$old_image" "$EXPECTED_REVISION"
  exit 0
fi
# Persist the image overlay: the next release needs every file recorded in the
# running container's Compose labels. This file contains no credentials.
release_dir="$PROJECT_DIR/frontend-releases/web-$EXPECTED_REVISION"
mkdir -p "$release_dir"
chmod 700 "$release_dir"
override="$release_dir/compose.yml"
cleanup() { rm -f "$IMAGE_ARCHIVE" "/tmp/proxyhubb-web-${EXPECTED_REVISION}.sh"; }
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
  chmod 600 "$override"
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
new_settings=$(docker inspect "$container" --format '{{json .Config.Env}}' | python3 -c 'import json,sys; print(json.dumps(dict(v.split("=",1) for v in json.load(sys.stdin))))' | python3 -c "$fingerprint")
[[ "$new_settings" == "$old_settings" ]]
private_code=$(curl --max-time 20 -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/assistant)
[[ "$private_code" == 401 ]]
code=$(curl --max-time 20 -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/app)
[[ "$code" =~ ^(200|302|303|307|308)$ ]]
public_code=$(curl --max-time 30 -sS -o /dev/null -w '%{http_code}' "https://proxyhubb.com/app?release=$EXPECTED_REVISION")
[[ "$public_code" =~ ^(200|302|303|307|308)$ ]]
trap - ERR
printf 'Frontend live: revision=%s workspace_http=%s public_http=%s rollback_image=%s\n' "$actual_revision" "$code" "$public_code" "$old_image"
