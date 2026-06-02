#!/usr/bin/env bash
# P3b split stack helpers. Source from p3-split-*.sh scripts.
export P3_COMPOSE_PROJECT="${P3_COMPOSE_PROJECT:-edge-p3-split}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export P3_COMPOSE_FILE="${P3_COMPOSE_FILE:-${SCRIPT_DIR}/../docker-compose.p3-split.yml}"
# shellcheck source=p3-compose.sh
source "${SCRIPT_DIR}/p3-compose.sh"
