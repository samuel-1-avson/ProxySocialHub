#!/usr/bin/env bash
# Retired — see scripts/gcp-deploy-web.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/lib/gcp-web-policy.sh
source "$SCRIPT_DIR/lib/gcp-web-policy.sh"
gcp_web_print_deprecated_landing
exit 1
