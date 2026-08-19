#!/usr/bin/env bash
# Run on the foreign VPS (not gen-lang-client-0022105784).
# Seed stays on this host. Publish operators-ext.json only.
set -euo pipefail
BIN="${W7D_JOIN_BIN:-/tmp/w7d-operator-join}"
# Do not pass W7D_DIR from Windows PowerShell ($HOME expands to C:\Users\...).
if [[ -n "${W7D_DIR:-}" && "$W7D_DIR" != *"\\"* && "$W7D_DIR" != *":"* ]]; then
  DIR="$W7D_DIR"
elif [[ "$(id -u)" -eq 0 ]]; then
  DIR=/opt/proxyhubb-w7d
else
  DIR="${HOME}/proxyhubb-w7d"
fi
PLATFORM_ORG="${PROXYHUB_PLATFORM_ORG_ID:-gen-lang-client-0022105784}"

chmod +x "$BIN"
mkdir -p "$DIR"
chmod 700 "$DIR"
cd "$DIR"
umask 077

IP=$(curl -fsS -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)
PROJECT=$(curl -fsS -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/project/project-id)
[[ "$PROJECT" != "$PLATFORM_ORG" ]] || {
  echo "FAIL: this VM is in the platform project $PLATFORM_ORG (not W7.D)"
  exit 2
}

if [[ ! -f operator-key.json ]]; then
  "$BIN" keygen > operator-key.json
  chmod 600 operator-key.json
  echo "keygen=created"
else
  echo "keygen=reused"
fi

export W12B_SLUG="${W12B_SLUG:-edge-ext}"
export W12B_ORG_ID="$PROJECT"
export W12B_HOST_ID="${W12B_HOST_ID:-gce-proxyhubb-w7d-ext}"
export W12B_BUYER_BASE_URL="http://${IP}:8090"
export W12B_HEALTH_URL="http://${IP}:8090/health"
export W12B_TUNNEL_ADDR="${IP}:3128"

"$BIN" sign-from-keygen < operator-key.json > operator-join.json
"$BIN" extract-bundle < operator-join.json > operators-ext.json
chmod 600 operator-key.json
chmod 644 operators-ext.json operator-join.json
if grep -q signing_key operators-ext.json; then
  echo "FAIL: bundle contains signing_key"
  exit 2
fi
echo "W7D_EXT_JOIN_OK org_id=$PROJECT host_id=$W12B_HOST_ID slug=$W12B_SLUG ip=$IP"
echo "bundle=$DIR/operators-ext.json"
echo "seed_stays=$DIR/operator-key.json"
