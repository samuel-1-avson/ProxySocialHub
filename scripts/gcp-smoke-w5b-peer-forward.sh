#!/usr/bin/env bash
# Wave 5.B — live cross-pod peer-forward soak (provider on A, buyer CONNECT via B).
# Expect: W5B_PEER_FORWARD_OK when route=remote (or peer bridge) is observed.
#
# Prerequisites:
#   - J2 multipod up
#   - A provider tunneled to edge-a :3128 (or use debug route if available)
#   - Buyer CONNECT through edge-b :18091
set -euo pipefail
cd /opt/proxyhubb 2>/dev/null || cd "$(dirname "$0")/.."

COMPOSE=(sudo docker compose
  -f docker-compose.yml
  -f docker-compose.testnet.yml
  -f docker-compose.gcp-testnet.yml
  -f docker-compose.j2-multipod.yml)

EDGE_A="${EDGE_A_URL:-http://127.0.0.1:18090}"
EDGE_B="${EDGE_B_URL:-http://127.0.0.1:18091}"

echo "=== health ==="
curl -fsS "$EDGE_A/health" | tee /tmp/w5b-a-health.json | head -c 200; echo
curl -fsS "$EDGE_B/health" | tee /tmp/w5b-b-health.json | head -c 200; echo

echo "=== directory / debug (best-effort) ==="
curl -fsS "$EDGE_A/debug/providers" -o /tmp/w5b-a-prov.json 2>/dev/null || true
curl -fsS "$EDGE_B/debug/providers" -o /tmp/w5b-b-prov.json 2>/dev/null || true
python3 - <<'PY' || true
import json,os
for p in ("/tmp/w5b-a-prov.json","/tmp/w5b-b-prov.json"):
  if not os.path.exists(p) or os.path.getsize(p)==0:
    print(p, "missing")
    continue
  try:
    d=json.load(open(p))
  except Exception as e:
    print(p, "parse", e); continue
  print(p, "keys", list(d)[:8] if isinstance(d,dict) else type(d))
PY

echo "=== recent peer-forward log markers (edge-b) ==="
"${COMPOSE[@]}" logs --tail=200 edge-gateway-b 2>/dev/null | tee /tmp/w5b-b-logs.txt | \
  grep -Ei 'route=remote|peer.?forward|bridge_via_peer|internal_forward|remote' | tail -20 || true

if grep -Eiq 'route=remote|bridge_via_peer|internal_forward|peer.?forward' /tmp/w5b-b-logs.txt; then
  echo "W5B_PEER_FORWARD_OK"
else
  echo "W5B_PEER_FORWARD_PENDING — no remote route marker in recent edge-b logs."
  echo "Run a buyer CONNECT to :18091 while a provider is owned by edge-a, then re-run."
  exit 2
fi
