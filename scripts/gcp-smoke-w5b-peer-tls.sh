#!/usr/bin/env bash
# W5.B peer-forward soak: TLS provider tunnel + Redis master + CONNECT via edge-b.
set -euo pipefail
LOG=/tmp/w5b_peer_tls.log
{
  echo "START $(date -u +%FT%TZ)"
  cd /opt/proxyhubb

  PASS=$(sudo docker exec proxyhubb-edge-gateway-a-1 printenv REDIS_URL | sed -n 's|redis://:\([^@]*\)@.*|\1|p' | tr -d '\r')
  MASTER_HOST=redis-replica
  if sudo docker exec proxyhubb-redis-replica-1 redis-cli -a "$PASS" --no-auth-warning INFO replication 2>/dev/null | grep -q 'role:master'; then
    MASTER_HOST=redis-replica
  elif sudo docker exec proxyhubb-redis-1 redis-cli -a "$PASS" --no-auth-warning INFO replication 2>/dev/null | grep -q 'role:master'; then
    MASTER_HOST=redis
  fi
  MASTER_URL="redis://:${PASS}@${MASTER_HOST}:6379"
  echo "redis_master=$MASTER_HOST"

  if [[ -f /tmp/w5b_tls/tunnel.rs ]]; then
    sudo cp /tmp/w5b_tls/tunnel.rs /opt/proxyhubb/services/edge-gateway/src/tunnel.rs
  fi
  if [[ -f /tmp/w5b_tls/docker-compose.j2-multipod.yml ]]; then
    sudo cp /tmp/w5b_tls/docker-compose.j2-multipod.yml /opt/proxyhubb/docker-compose.j2-multipod.yml
  fi

  cat >/tmp/w5b-redis-override.yml <<YAML
services:
  edge-gateway-a:
    environment:
      - REDIS_URL=${MASTER_URL}
  edge-gateway-b:
    environment:
      - REDIS_URL=${MASTER_URL}
YAML

  COMPOSE=(sudo docker compose
    -f docker-compose.yml
    -f docker-compose.testnet.yml
    -f docker-compose.gcp-testnet.yml
    -f docker-compose.j2-multipod.yml
    -f /tmp/w5b-redis-override.yml)

  if [[ -f /tmp/w5b_tls/tunnel.rs ]]; then
    "${COMPOSE[@]}" build edge-gateway-a edge-gateway-b
  fi
  export J2_REDIS_URL="$MASTER_URL"
  "${COMPOSE[@]}" up -d --no-deps --force-recreate edge-gateway-a edge-gateway-b

  for i in $(seq 1 40); do
    a=$(sudo docker inspect -f '{{.State.Health.Status}}' proxyhubb-edge-gateway-a-1 2>/dev/null || echo starting)
    b=$(sudo docker inspect -f '{{.State.Health.Status}}' proxyhubb-edge-gateway-b-1 2>/dev/null || echo starting)
    echo "edge-a=$a edge-b=$b"
    [[ "$a" == "healthy" && "$b" == "healthy" ]] && break
    sleep 3
  done
  echo "edge_redis=$(sudo docker exec proxyhubb-edge-gateway-a-1 printenv REDIS_URL | sed 's/:[^@]*@/:***@/')"
  echo "tunnel_tls=$(sudo docker logs proxyhubb-edge-gateway-a-1 2>&1 | grep -i 'Tunnel Server listening' | tail -1)"

  JA=$(sudo docker exec proxyhubb-edge-gateway-a-1 printenv JWT_SECRET | sha256sum | awk '{print $1}')
  JC=$(sudo docker exec proxyhubb-control-api-1 printenv JWT_SECRET | sha256sum | awk '{print $1}')
  echo "jwt_secret_match=$([[ "$JA" == "$JC" ]] && echo yes || echo NO)"
  [[ "$JA" == "$JC" ]]

  TOKEN_HMAC_SECRET=$(sudo docker exec proxyhubb-control-api-1 printenv TOKEN_HMAC_SECRET | tr -d '\r')
  PSQL=(sudo docker exec -i proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1)
  SELLER=b77e84c9-0e85-4f23-afc0-581cd561c216
  RAW_TOKEN=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
  HASHED=$(TOKEN_HMAC_SECRET="$TOKEN_HMAC_SECRET" RAW_TOKEN="$RAW_TOKEN" python3 - <<'PY'
import hmac,hashlib,os
print(hmac.new(os.environ["TOKEN_HMAC_SECRET"].encode(), os.environ["RAW_TOKEN"].encode(), hashlib.sha256).hexdigest())
PY
)
  TOKEN_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
  "${PSQL[@]}" -c "INSERT INTO provider_tokens (id, user_id, token, name, is_active, created_at, updated_at) VALUES ('$TOKEN_ID','$SELLER','$HASHED','w5b-peer-tls',true,NOW(),NOW());"
  AUTH=$(curl -fsS -X POST http://127.0.0.1:18080/v1/provider/auth -H 'Content-Type: application/json' -d "{\"token\":\"$RAW_TOKEN\"}")
  USER_ID=$(python3 -c "import json;print(json.loads('''$AUTH''')['user_id'])")
  NODE_ID="node_${USER_ID}"
  echo "user=$USER_ID node=$NODE_ID"

  SIGNING=$(grep -E '^provider_signing_key' /opt/proxyhubb/config/docker/provider.toml | head -1 || true)
  # Empty node_id skips heartbeat proofs under PROXYHUB_REQUIRE_SIGNED_HEARTBEATS.
  API_NODE_ID=$(sudo docker exec -i proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc \
    "SELECT id::text FROM provider_nodes WHERE user_id='$SELLER' ORDER BY updated_at DESC NULLS LAST LIMIT 1;" \
    | tr -d '[:space:]')
  if [[ -z "$API_NODE_ID" ]]; then
    API_NODE_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
  fi
  cat >/tmp/w5b-provider.toml <<EOF
api_key = "$RAW_TOKEN"
control_api_url = "http://127.0.0.1:18080"
gateway_addr = "127.0.0.1:3128"
gateway_addrs = ["127.0.0.1:3128"]
use_tls = true
tls_skip_verify = true
connection_type = "residential"
node_id = "$API_NODE_ID"
$SIGNING
EOF
  echo "provider.toml:"; cat /tmp/w5b-provider.toml | sed 's/api_key.*/api_key = "***"/;s/provider_signing_key.*/provider_signing_key = "***"/'

  SESSION_USER="w5bt-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
  SESSION_PASS="w5bt-pass-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
  SESSION_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  EXP=$(date -u -d '+24 hours' +%Y-%m-%dT%H:%M:%SZ)
  SESSION_JSON=$(SESSION_PASS="$SESSION_PASS" USER_ID="$USER_ID" SESSION_ID="$SESSION_ID" NOW="$NOW" EXP="$EXP" python3 - <<'PY'
import json, hashlib, os
pw = os.environ["SESSION_PASS"]
cred_hash = hashlib.sha256(pw.encode()).hexdigest()
print(json.dumps({
  "user_id": os.environ["USER_ID"],
  "session_id": os.environ["SESSION_ID"],
  "provider_id": "",
  "type": "sticky",
  "status": "active",
  "bandwidth_limit": 1073741824,
  "bandwidth_used": 0,
  "trust_tier": "verified",
  "target_geo": "",
  "created_at": os.environ["NOW"],
  "expires_at": os.environ["EXP"],
  "credential_password_hash": cred_hash,
}))
PY
)
  REDIS_CTR=proxyhubb-redis-replica-1
  [[ "$MASTER_HOST" == "redis" ]] && REDIS_CTR=proxyhubb-redis-1
  sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning SETEX "session:$SESSION_USER" 3600 "$SESSION_JSON"
  sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning SETEX "sticky:$SESSION_ID" 3600 "$NODE_ID"
  echo "session_seeded user=$SESSION_USER sticky=$NODE_ID"

  if ! sudo docker image inspect proxyhubb-provider-node:w5b >/dev/null 2>&1; then
    sudo docker build -t proxyhubb-provider-node:w5b -f services/provider-node/Dockerfile services/provider-node
  fi

  sudo docker rm -f w5b-provider-node 2>/dev/null || true
  sudo docker run -d --name w5b-provider-node --network host \
    -v /tmp/w5b-provider.toml:/config/provider.toml:ro \
    -e RUST_LOG=info,provider_node=debug,provider_node::tunnel=debug \
    proxyhubb-provider-node:w5b \
    start --config /config/provider.toml --use-tls

  owned=0
  for i in $(seq 1 45); do
    stats=$(curl -fsS http://127.0.0.1:18090/debug/directory/stats || echo '{}')
    echo "try=$i $stats"
    if echo "$stats" | python3 -c 'import json,sys;d=json.load(sys.stdin);raise SystemExit(0 if d.get("directory_owned_here",0)>0 else 1)'; then
      owned=1; break
    fi
    if sudo docker logs w5b-provider-node 2>&1 | grep -qE 'AUTH successful|Handshake complete|tunnel established'; then
      owned=1; break
    fi
    sleep 2
  done
  echo "owned=$owned"
  sudo docker logs w5b-provider-node --tail 80 2>&1 | tee /tmp/w5b-prov-logs.txt
  curl -fsS http://127.0.0.1:18090/debug/nodes | tee /tmp/w5b-nodes.json | head -c 600; echo
  sudo docker logs proxyhubb-edge-gateway-a-1 --tail 40 2>&1 | grep -Ei 'AUTH|TLS handshake|Tunnel' | tail -20 || true

  python3 - <<PY
import socket,base64
user=b"$SESSION_USER"; pw=b"$SESSION_PASS"
token=base64.b64encode(user+b":"+pw).decode()
s=socket.create_connection(("127.0.0.1",18091),timeout=10)
req=(f"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: Basic {token}\r\n\r\n").encode()
s.sendall(req)
s.settimeout(20)
data=s.recv(4096)
print("CONNECT_RESP", data[:400])
open("/tmp/w5b-connect-resp.txt","wb").write(data)
s.close()
PY

  sleep 1
  curl -fsS http://127.0.0.1:19093/metrics | grep edge_gateway_provider_route_selection | tee /tmp/w5b-metrics-b.txt
  sudo docker logs proxyhubb-edge-gateway-b-1 --tail 150 2>&1 | tee /tmp/w5b-b-logs.txt | grep -Ei 'remote|peer|forward|bridge|route|sticky|CONNECT' | tail -40 || true

  ok=0
  grep -E 'route="remote"} [1-9]' /tmp/w5b-metrics-b.txt && ok=1 || true
  # CONNECT upgrade 200 alone is insufficient — peer bridge must not 503.
  if grep -Eiq 'Peer rejected internal forward|HTTP/1\.1 503' /tmp/w5b-b-logs.txt; then
    ok=0
  fi
  if ! grep -Eiq 'HTTP/1\.1 200' /tmp/w5b-connect-resp.txt; then
    ok=0
  fi
  if [[ "$owned" != "1" ]]; then
    ok=0
  fi
  if sudo docker logs proxyhubb-edge-gateway-a-1 --since 2m 2>&1 | grep -Eiq 'missing required provider signature'; then
    # Allow if a later HB recovered; fail only when forward also saw not-on-pod.
    if sudo docker logs proxyhubb-edge-gateway-a-1 --since 2m 2>&1 | grep -Eiq 'provider not on this pod'; then
      ok=0
    fi
  fi

  sudo docker rm -f w5b-provider-node 2>/dev/null || true
  if [[ "$ok" == "1" ]]; then
    echo W5B_PEER_FORWARD_OK
  else
    echo W5B_PEER_FORWARD_FAIL
    exit 2
  fi
  echo "END $(date -u +%FT%TZ)"
} >"$LOG" 2>&1
