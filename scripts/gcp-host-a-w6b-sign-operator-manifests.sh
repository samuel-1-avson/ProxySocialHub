#!/usr/bin/env bash
# Host-A W6.B — give the seeded platform operators a signing key so the pinned
# discovery bundle verifies offline instead of listing as "unsigned".
#
# Read-only by default. Applying needs CONFIRM_W6B_SIGN=1.
#
#   bash /tmp/gcp-host-a-w6b-sign-operator-manifests.sh            # inspect
#   CONFIRM_W6B_SIGN=1 bash /tmp/gcp-host-a-w6b-sign-operator-manifests.sh
#
# Seeds are written straight into /opt/proxyhubb/.env and never printed.
# Does not touch capability mode, listing mode, or slash gates.
# Same-org platform hosts: this does not make operator_org_diversity multi_org.
set -euo pipefail
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"
BIN="${W6B_BIN:-/tmp/w9d-bin}"
PINNED="$ROOT/ops/operators-bundle.json"
CTR=proxyhubb-control-api-1

cd "$ROOT"

COMPOSE=(-f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.w6-host-a-private.yml -f docker-compose.w10-observe.yml)

report() {
  echo "--- pinned bundle ---"
  "$BIN/w7b-manifest-bundle" list "$PINNED" || true
}

echo "=== W6.B operator manifest signing (Host-A) ==="
[[ -x "$BIN/w7b-manifest-bundle" ]] || { echo "FAIL: missing $BIN/w7b-manifest-bundle"; exit 2; }
[[ -f "$PINNED" ]] || { echo "FAIL: missing $PINNED"; exit 2; }

have_a=$(sudo grep -c '^GATEWAY_OP_A_SIGNING_KEY=' .env || true)
have_b=$(sudo grep -c '^GATEWAY_OP_B_SIGNING_KEY=' .env || true)
echo "signing_key_a_present=$have_a signing_key_b_present=$have_b"
report

if [[ "${CONFIRM_W6B_SIGN:-}" != "1" ]]; then
  echo "INSPECT ONLY: set CONFIRM_W6B_SIGN=1 to sign and re-pin"
  exit 0
fi

[[ -x "$BIN/w7d-operator-join" ]] || { echo "FAIL: missing $BIN/w7d-operator-join"; exit 2; }

stamp=$(date -u +%Y%m%d%H%M%S)
sudo cp -a .env ".env.bak.w6b-sign-$stamp"
echo "env_backup=.env.bak.w6b-sign-$stamp"

# Seeds go from the generator into .env without passing through stdout.
add_key() {
  local envkey="$1" tmp
  if sudo grep -q "^${envkey}=" .env; then
    echo "${envkey}=already_present"
    return
  fi
  tmp=$(mktemp)
  "$BIN/w7d-operator-join" keygen > "$tmp"
  local seed pub
  seed=$(sed -n 's/.*"signing_key":"\([^"]*\)".*/\1/p' "$tmp")
  pub=$(sed -n 's/.*"pubkey":"\([^"]*\)".*/\1/p' "$tmp")
  [[ -n "$seed" ]] || { shred -u "$tmp" 2>/dev/null || rm -f "$tmp"; echo "FAIL: empty seed for $envkey"; exit 2; }
  printf '%s=%s\n' "$envkey" "$seed" | sudo tee -a .env >/dev/null
  shred -u "$tmp" 2>/dev/null || rm -f "$tmp"
  echo "${envkey}=written pubkey=${pub}"
}

add_key GATEWAY_OP_A_SIGNING_KEY
add_key GATEWAY_OP_B_SIGNING_KEY
sudo chmod 600 .env

# Recreate control-api so SeedFromEnv re-signs the rows. Every overlay must be
# present: without w6-host-a-private the GATEWAY_OP_* host ids are cleared and
# the fleet reports same_host. Never --remove-orphans (J2 edges and redis-ha
# look like orphans to an API-only compose).
sudo docker compose "${COMPOSE[@]}" up -d --force-recreate --no-deps control-api

for _ in $(seq 1 40); do
  st=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CTR" 2>/dev/null || echo missing)
  [[ "$st" == "healthy" ]] && break
  sleep 3
done
curl -fsS --max-time 5 "$API/health" >/dev/null
echo "api_up=1"

cap=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY || true)
gop_a=$(sudo docker exec "$CTR" printenv GATEWAY_OP_A_HOST_ID || true)
gop_b=$(sudo docker exec "$CTR" printenv GATEWAY_OP_B_HOST_ID || true)
echo "session_capability=${cap}"
echo "gateway_op_a=${gop_a}"
echo "gateway_op_b=${gop_b}"
[[ "$cap" == "observe" ]] || { echo "FAIL: W10.A observe was lost"; exit 2; }
[[ -n "$gop_a" && -n "$gop_b" ]] || { echo "FAIL: GATEWAY_OP_* host ids cleared"; exit 2; }

curl -fsS --max-time 10 "$API/v1/gateways/operators/bundle" > /tmp/operators-bundle.new.json
"$BIN/w7b-manifest-bundle" list /tmp/operators-bundle.new.json
"$BIN/w7b-manifest-bundle" verify /tmp/operators-bundle.new.json

sudo cp -a "$PINNED" "$PINNED.bak.$stamp"
sudo cp /tmp/operators-bundle.new.json "$PINNED"
rm -f /tmp/operators-bundle.new.json

# control-api and edge-b read /etc/proxyhubb/operators-bundle.json *inside* the
# container, bind-mounted from $PINNED. There is no host /etc/proxyhubb.
sudo docker exec "$CTR" sh -c 'head -c 64 /etc/proxyhubb/operators-bundle.json' >/dev/null 2>&1 \
  && echo "container_pin_readable=1" || echo "container_pin_readable=0"

"$BIN/w7b-manifest-bundle" verify "$PINNED"
echo "W6B_MANIFEST_SIGNED_OK"
echo "still same_org; platform holds both keys; not W7.D; not DePIN"
