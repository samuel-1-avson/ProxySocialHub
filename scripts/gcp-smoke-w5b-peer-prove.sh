#!/usr/bin/env bash
# Prove peer-forward with signed HB + tunneled HTTPS GET via edge-b.
set -euo pipefail
LOG=/tmp/w5b_peer_prove.log
exec >"$LOG" 2>&1
echo "START $(date -u +%FT%TZ)"

PASS=$(sudo docker exec proxyhubb-edge-gateway-a-1 printenv REDIS_URL | sed -n 's|redis://:\([^@]*\)@.*|\1|p' | tr -d '\r')
EDGE_REDIS_HOST=$(sudo docker exec proxyhubb-edge-gateway-a-1 printenv REDIS_URL | sed -n 's|redis://:[^@]*@\([^:]*\):.*|\1|p' | tr -d '\r')
REDIS_CTR=proxyhubb-redis-1
[[ "$EDGE_REDIS_HOST" == "redis-replica" ]] && REDIS_CTR=proxyhubb-redis-replica-1
echo "edge_redis_host=$EDGE_REDIS_HOST"

# Recreate edges with debug logs for forward path
cd /opt/proxyhubb
MASTER_URL="redis://:${PASS}@${EDGE_REDIS_HOST}:6379"
cat >/tmp/w5b-redis-override.yml <<YAML
services:
  edge-gateway-a:
    environment:
      - REDIS_URL=${MASTER_URL}
      - RUST_LOG=info,edge_gateway::internal_forward=debug,edge_gateway=info
  edge-gateway-b:
    environment:
      - REDIS_URL=${MASTER_URL}
      - RUST_LOG=info,edge_gateway::internal_forward=debug,edge_gateway=info
YAML
sudo docker compose \
  -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml \
  -f docker-compose.j2-multipod.yml -f /tmp/w5b-redis-override.yml \
  up -d --no-deps --force-recreate edge-gateway-a edge-gateway-b
for i in $(seq 1 40); do
  a=$(sudo docker inspect -f '{{.State.Health.Status}}' proxyhubb-edge-gateway-a-1 2>/dev/null || echo starting)
  b=$(sudo docker inspect -f '{{.State.Health.Status}}' proxyhubb-edge-gateway-b-1 2>/dev/null || echo starting)
  [[ "$a" == "healthy" && "$b" == "healthy" ]] && break
  sleep 2
done

TOKEN_HMAC_SECRET=$(sudo docker exec proxyhubb-control-api-1 printenv TOKEN_HMAC_SECRET | tr -d '\r')
SELLER=b77e84c9-0e85-4f23-afc0-581cd561c216
RAW_TOKEN=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
HASHED=$(python3 -c "import hmac,hashlib; print(hmac.new(b'''$TOKEN_HMAC_SECRET''', b'''$RAW_TOKEN''', hashlib.sha256).hexdigest())")
TOKEN_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
sudo docker exec -i proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 \
  -c "INSERT INTO provider_tokens (id, user_id, token, name, is_active, created_at, updated_at) VALUES ('$TOKEN_ID','$SELLER','$HASHED','w5b-peer-prove',true,NOW(),NOW());"
AUTH=$(curl -fsS -X POST http://127.0.0.1:18080/v1/provider/auth -H 'Content-Type: application/json' -d "{\"token\":\"$RAW_TOKEN\"}")
USER_ID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['user_id'])" "$AUTH")
NODE_ID="node_${USER_ID}"
API_NODE_ID=$(sudo docker exec -i proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc \
  "SELECT id::text FROM provider_nodes WHERE user_id='$SELLER' ORDER BY updated_at DESC NULLS LAST LIMIT 1;" | tr -d '[:space:]')
[[ -z "$API_NODE_ID" ]] && API_NODE_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
SIGNING=$(grep -E '^provider_signing_key' /opt/proxyhubb/config/docker/provider.toml | head -1 || true)
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

SESSION_USER="w5bp-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
SESSION_PASS="w5bp-pass-$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
SESSION_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EXP=$(date -u -d '+24 hours' +%Y-%m-%dT%H:%M:%SZ)
CRED_HASH=$(python3 -c "import hashlib; print(hashlib.sha256(b'''$SESSION_PASS''').hexdigest())")
SESSION_JSON=$(python3 -c "import json; print(json.dumps({'user_id':'''$USER_ID''','session_id':'''$SESSION_ID''','provider_id':'','type':'sticky','status':'active','bandwidth_limit':1073741824,'bandwidth_used':0,'trust_tier':'verified','target_geo':'','created_at':'''$NOW''','expires_at':'''$EXP''','credential_password_hash':'''$CRED_HASH'''}))")
sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning SETEX "session:$SESSION_USER" 3600 "$SESSION_JSON"
sudo docker exec "$REDIS_CTR" redis-cli -a "$PASS" --no-auth-warning SETEX "sticky:$SESSION_ID" 3600 "$NODE_ID"

REMOTE_BEFORE=$(curl -fsS http://127.0.0.1:19093/metrics | awk '/route="remote"}/{print $2; exit}' || echo 0)

sudo docker rm -f w5b-provider-node 2>/dev/null || true
sudo docker run -d --name w5b-provider-node --network host \
  -v /tmp/w5b-provider.toml:/config/provider.toml:ro \
  -e RUST_LOG=info \
  proxyhubb-provider-node:w5b \
  start --config /config/provider.toml --use-tls

# Wait until owned AND no signature miss in recent window after connect
for i in $(seq 1 30); do
  stats=$(curl -fsS http://127.0.0.1:18090/debug/directory/stats || echo '{}')
  owned=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('directory_owned_here',0))" "$stats")
  miss=$(sudo docker logs proxyhubb-edge-gateway-a-1 --since 15s 2>&1 | grep -c 'missing required provider signature' || true)
  echo "try=$i owned=$owned miss=$miss"
  if [[ "$owned" -ge 1 && "${miss:-0}" == "0" ]]; then
    sleep 2
    miss2=$(sudo docker logs proxyhubb-edge-gateway-a-1 --since 10s 2>&1 | grep -c 'missing required provider signature' || true)
    if [[ "${miss2:-0}" == "0" ]]; then break; fi
  fi
  sleep 2
done

# Tunneled HTTPS GET via CONNECT (proves bridge, not just upgrade ack)
export SESSION_USER SESSION_PASS
python3 - <<'PY'
import base64, os, socket, ssl, sys
user = os.environ["SESSION_USER"].encode()
pw = os.environ["SESSION_PASS"].encode()
token = base64.b64encode(user + b":" + pw).decode()
s = socket.create_connection(("127.0.0.1", 18091), timeout=15)
s.sendall(
    f"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: Basic {token}\r\n\r\n".encode()
)
s.settimeout(20)
buf = b""
while b"\r\n\r\n" not in buf:
    chunk = s.recv(4096)
    if not chunk:
        break
    buf += chunk
print("CONNECT_RESP", buf.split(b"\r\n\r\n", 1)[0][:300])
open("/tmp/w5b-connect-resp.txt", "wb").write(buf)
if b" 200 " not in buf.split(b"\r\n", 1)[0]:
    print("CONNECT_FAIL")
    sys.exit(2)
ctx = ssl.create_default_context()
tls = ctx.wrap_socket(s, server_hostname="example.com")
tls.sendall(b"GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n")
body = b""
tls.settimeout(20)
while True:
    try:
        chunk = tls.recv(8192)
    except Exception as e:
        print("TLS_RECV_ERR", e)
        break
    if not chunk:
        break
    body += chunk
    if len(body) > 2000:
        break
print("ORIGIN_HEAD", body[:300])
open("/tmp/w5b-origin.txt", "wb").write(body[:2000])
tls.close()
if b"HTTP/" not in body and b"Example Domain" not in body:
    print("ORIGIN_FAIL")
    sys.exit(3)
print("ORIGIN_OK")
PY

sleep 1
curl -fsS http://127.0.0.1:19093/metrics | grep edge_gateway_provider_route_selection | tee /tmp/w5b-metrics-b.txt
sudo docker logs proxyhubb-edge-gateway-a-1 --since 2m 2>&1 | tee /tmp/w5b-a-full.txt | grep -Ei 'Internal forward|Accepting|signature|unhealthy|not on this pod|Peer' | tail -40
sudo docker logs proxyhubb-edge-gateway-b-1 --since 2m 2>&1 | tee /tmp/w5b-b-full.txt | grep -Ei 'Tunnel error|peer|forward|Routing via|remote|bridge' | tail -40

REMOTE_AFTER=$(awk '/route="remote"}/{print $2; exit}' /tmp/w5b-metrics-b.txt)
echo "remote_before=$REMOTE_BEFORE remote_after=$REMOTE_AFTER"

ok=1
python3 -c "import sys; sys.exit(0 if float('''$REMOTE_AFTER''' or 0) > float('''$REMOTE_BEFORE''' or 0) else 1)" || ok=0
grep -Eiq 'Peer rejected|provider not on this pod' /tmp/w5b-a-full.txt /tmp/w5b-b-full.txt && ok=0 || true
grep -Eiq 'Accepting internal peer forward' /tmp/w5b-a-full.txt || ok=0
grep -Eiq 'ORIGIN_OK' /tmp/w5b_peer_prove.log || ok=0

sudo docker rm -f w5b-provider-node 2>/dev/null || true
if [[ "$ok" == "1" ]]; then
  echo W5B_PEER_FORWARD_OK
else
  echo W5B_PEER_FORWARD_FAIL
  exit 2
fi
echo "END $(date -u +%FT%TZ)"
