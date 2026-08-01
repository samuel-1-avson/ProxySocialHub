#!/usr/bin/env bash
# Shared policy for GCP web deploys. Source from other scripts:
#   # shellcheck source=scripts/lib/gcp-web-policy.sh
#   source "$(dirname "$0")/lib/gcp-web-policy.sh"
#
# Canonical public web URL: https://proxyhubb.com (apex).
# Canonical deploy path: GHCR pull via docker-compose.gcp-images.yml.
# VM source rebuild is emergency-only (see gcp-deploy-web-emergency-build.sh).

# shellcheck disable=SC2034
PROXYHUBB_WEB_CANONICAL_URL="${PROXYHUBB_WEB_CANONICAL_URL:-https://proxyhubb.com}"
PROXYHUBB_WEB_ALIAS_URLS="${PROXYHUBB_WEB_ALIAS_URLS:-https://www.proxyhubb.com https://app.proxyhubb.com}"
PROXYHUBB_WEB_CONTAINER="${PROXYHUBB_WEB_CONTAINER:-proxyhubb-web-1}"

# Sets global COMPOSE array for GHCR overlay deploys.
# Pass docker binary as arg2 (default: docker). For rootless on GCE use:
#   DOCKER=docker with `sudo -E bash ./scripts/gcp-deploy-web.sh`
# or set COMPOSE_DOCKER_CLI_BUILD etc. — do not pass "sudo docker" as one token.
gcp_web_compose_ghcr() {
  local project_dir="${1:?project dir}"
  local docker_bin="${2:-docker}"
  COMPOSE=(
    "$docker_bin" compose
    -f "$project_dir/docker-compose.yml"
    -f "$project_dir/docker-compose.testnet.yml"
    -f "$project_dir/docker-compose.gcp-testnet.yml"
    -f "$project_dir/docker-compose.gcp-images.yml"
  )
}

# Sets global COMPOSE array for on-VM build (no GHCR overlay).
gcp_web_compose_build() {
  local project_dir="${1:?project dir}"
  local docker_bin="${2:-docker}"
  COMPOSE=(
    "$docker_bin" compose
    -f "$project_dir/docker-compose.yml"
    -f "$project_dir/docker-compose.testnet.yml"
    -f "$project_dir/docker-compose.gcp-testnet.yml"
  )
}

gcp_web_print_deprecated_landing() {
  cat <<'EOF'
ERROR: Legacy landing tarball deploys are retired.

Canonical web deploy (GHCR):
  IMAGE_TAG=<tag> ./scripts/gcp-deploy-web.sh

Full stack pull + migrate:
  IMAGE_TAG=<tag> ./scripts/gcp-compose-pull-deploy.sh

Emergency VM rebuild only (requires ALLOW_EMERGENCY_WEB_BUILD=1):
  ALLOW_EMERGENCY_WEB_BUILD=1 ./scripts/gcp-deploy-web-emergency-build.sh

Canonical hostname: https://proxyhubb.com
  (www / app should 301 — see config/gcp/Caddyfile.example)
EOF
}
