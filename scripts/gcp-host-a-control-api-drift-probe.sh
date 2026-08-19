#!/usr/bin/env bash
# Read-only: how far the running Host-A control-api binary has drifted from the
# repo. Answers "which wave features are actually live" without trusting docs.
#
#   bash /tmp/gcp-host-a-control-api-drift-probe.sh
set -uo pipefail
C=proxyhubb-control-api-1

echo "=== Host-A control-api drift probe ==="
sudo docker inspect -f 'image={{.Config.Image}} created={{.Created}}' "$C"

echo "--- locate the binary ---"
BIN=$(sudo docker inspect -f '{{join .Config.Cmd " "}} {{join .Config.Entrypoint " "}}' "$C")
echo "entry=$BIN"
sudo docker exec "$C" sh -c 'ls -la /app 2>/dev/null | head -20; echo "--"; ls -la / | head -20'
CANDIDATE=$(sudo docker exec "$C" sh -c 'for p in /server /app/control-api /app/main /app/server /control-api /usr/local/bin/control-api; do [ -f "$p" ] && echo "$p" && break; done')
echo "binary=${CANDIDATE:-not_found}"
[ -n "$CANDIDATE" ] || { echo "SKIP string probe: binary not located"; CANDIDATE=/nonexistent; }

echo "--- feature strings in the running binary ---"
for s in \
  "listing commitment registered on-chain" \
  "listing commitment: register started" \
  "PROXYHUB_USAGE_CHALLENGE" \
  "operators_and_control_api" \
  "bonded_gateway_program" \
  "settlement-receipts" \
  "listing_commitment_mode" \
  "PROXYHUB_OPERATOR_MANIFEST_BUNDLE"
do
  if sudo docker exec "$C" sh -c "grep -a -q -- '$s' '$CANDIDATE' 2>/dev/null"; then
    echo "present  $s"
  else
    echo "MISSING  $s"
  fi
done

echo "--- relevant env ---"
for k in PROXYHUB_LISTING_COMMITMENT PROXYHUB_SESSION_CAPABILITY PROXYHUB_OPERATOR_MANIFEST PROXYHUB_OPERATOR_BUNDLE_PATH; do
  v=$(sudo docker exec "$C" printenv "$k" 2>/dev/null || echo "unset")
  echo "$k=$v"
done

echo "--- source tree on the VM ---"
ls -d /opt/proxyhubb/services/control-api 2>/dev/null || echo "no control-api source on VM"
ls /opt/proxyhubb/services 2>/dev/null | head -10
