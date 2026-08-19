#!/usr/bin/env bash
# Host-A: cache W7.D foreign operator. Never recreate control-api.
set -euo pipefail
BUNDLE="${1:-/tmp/operators-ext.json}"
CACHE="${2:-/tmp/gcp-w7d-cache-foreign-operator.sh}"

before=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
echo "BEFORE_STARTED=$before"
echo -n "BEFORE_CAP="; sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_SESSION_CAPABILITY
echo -n "BEFORE_LISTING="; sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_LISTING_COMMITMENT
echo -n "BEFORE_SLASH_AUTO="; sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_GATEWAY_SLASH_AUTO || true
echo -n "BEFORE_SLASH_CONFIRM="; sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_GATEWAY_SLASH_CONFIRM || true

tr -d '\015' < "$CACHE" | bash -s "$BUNDLE"

after=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
echo "AFTER_STARTED=$after"
echo -n "AFTER_CAP="; sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_SESSION_CAPABILITY
echo -n "AFTER_LISTING="; sudo docker exec proxyhubb-control-api-1 printenv PROXYHUB_LISTING_COMMITMENT
if [[ "$before" != "$after" ]]; then
  echo "FAIL: control-api StartedAt changed (W10.A soak would restart)"
  exit 2
fi
echo "W7D_CONTROL_API_UNTOUCHED"
