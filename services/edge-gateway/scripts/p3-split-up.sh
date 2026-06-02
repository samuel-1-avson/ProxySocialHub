#!/usr/bin/env bash
# Start P3b split stack.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=p3-split-compose.sh
source "${SCRIPT_DIR}/p3-split-compose.sh"
cd "${SCRIPT_DIR}/.."
args=(up -d)
if [[ "${1:-}" == "-Build" || "${1:-}" == "--build" ]]; then
  args+=(--build)
fi
echo "== docker compose -p ${P3_COMPOSE_PROJECT} (split) up =="
p3_compose "${args[@]}"
echo "Verify: ./scripts/p3-split-smoke.sh"
