#!/usr/bin/env bash
# Sprint J2 multipod smoke (Wave 2.1).
# Expect: SPRINT_J2_MULTIPOD_OK
#
# Prerequisites: compose stack with docker-compose.j2-multipod.yml applied.
set -euo pipefail
cd /opt/proxyhubb 2>/dev/null || cd "$(dirname "$0")/.."

COMPOSE=(docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
  -f docker-compose.j2-multipod.yml)

EDGE_A="${EDGE_A_URL:-http://127.0.0.1:18090}"
EDGE_B="${EDGE_B_URL:-http://127.0.0.1:18091}"

echo "=== J2: both pods healthy with distinct edge_pod_id ==="
HA=$(curl -sS -D /tmp/j2-a.hdr -o /tmp/j2-a.json "$EDGE_A/health" || true)
HB=$(curl -sS -D /tmp/j2-b.hdr -o /tmp/j2-b.json "$EDGE_B/health" || true)
echo "A body=$(head -c 200 /tmp/j2-a.json)"
echo "B body=$(head -c 200 /tmp/j2-b.json)"
grep -q '"status":"healthy"' /tmp/j2-a.json
grep -q '"status":"healthy"' /tmp/j2-b.json
grep -q '"edge_pod_id":"edge-a"' /tmp/j2-a.json || grep -qi 'edge-a' /tmp/j2-a.hdr
grep -q '"edge_pod_id":"edge-b"' /tmp/j2-b.json || grep -qi 'edge-b' /tmp/j2-b.hdr
POD_A=$(grep -i '^X-Edge-Pod-Id:' /tmp/j2-a.hdr | tr -d '\r' | awk '{print $2}')
POD_B=$(grep -i '^X-Edge-Pod-Id:' /tmp/j2-b.hdr | tr -d '\r' | awk '{print $2}')
echo "header_pod_a=${POD_A:-} header_pod_b=${POD_B:-}"
[[ -n "${POD_A:-}" && -n "${POD_B:-}" && "$POD_A" != "$POD_B" ]] || {
  # Body fields are enough if headers stripped by proxy
  grep -q edge-a /tmp/j2-a.json
  grep -q edge-b /tmp/j2-b.json
}

echo "=== J2: EDGE_MODE colocated on both ==="
MODE_A=$("${COMPOSE[@]}" exec -T edge-gateway-a sh -c 'printenv EDGE_MODE' | tr -d '\r' || true)
MODE_B=$("${COMPOSE[@]}" exec -T edge-gateway-b sh -c 'printenv EDGE_MODE' | tr -d '\r' || true)
echo "mode_a=$MODE_A mode_b=$MODE_B"
[[ "$MODE_A" == "colocated" && "$MODE_B" == "colocated" ]] || {
  echo "EDGE_MODE must be colocated on both pods"; exit 1;
}

echo "=== J2: EDGE_PEER_URLS cross-wired ==="
PEER_A=$("${COMPOSE[@]}" exec -T edge-gateway-a sh -c 'printenv EDGE_PEER_URLS' | tr -d '\r' || true)
PEER_B=$("${COMPOSE[@]}" exec -T edge-gateway-b sh -c 'printenv EDGE_PEER_URLS' | tr -d '\r' || true)
echo "peer_a=$PEER_A"
echo "peer_b=$PEER_B"
echo "$PEER_A" | grep -q 'edge-b@'
echo "$PEER_B" | grep -q 'edge-a@'

echo "=== J2: kill edge-a briefly; edge-b must stay healthy ==="
"${COMPOSE[@]}" stop edge-gateway-a
sleep 2
curl -sS -o /tmp/j2-b2.json "$EDGE_B/health"
grep -q '"status":"healthy"' /tmp/j2-b2.json
"${COMPOSE[@]}" start edge-gateway-a
sleep 5
curl -sS -o /tmp/j2-a2.json "$EDGE_A/health"
grep -q '"status":"healthy"' /tmp/j2-a2.json

echo "SPRINT_J2_MULTIPOD_OK"
echo "PARTIAL: same-VM multipod; tunnels sticky per pod; host SPOF remains; not multi-operator."
