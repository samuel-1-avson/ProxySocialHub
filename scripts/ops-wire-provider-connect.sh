#!/usr/bin/env bash
# Wire smoke listing to live provider-node: refresh token, ensure node/listing, restart, verify tunnel.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
COMPOSE_P=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml -f docker-compose.provider.yml --profile provider)

SELLER="${SELLER:-b77e84c9-0e85-4f23-afc0-581cd561c216}"
SMOKE_LISTING="${SMOKE_LISTING:-c1472dbc-dee3-407e-8fea-ec3ed42489ac}"
LIVE_NODE="$(grep -E '^node_id' config/docker/provider.toml 2>/dev/null | sed -E 's/.*=\s*"?([^"]+)"?.*/\1/' | tr -d '[:space:]' || true)"
LIVE_NODE="${LIVE_NODE:-99d66ece-bee4-4d98-80d6-53f23e85a94a}"
HOTKEY="$(docker logs proxyhubb-provider-node 2>&1 | grep -oE 'provider_hotkey=[A-Za-z0-9]+' | tail -1 | cut -d= -f2 || true)"
HOTKEY="${HOTKEY:-9aAxaf45WQCJmHJmT71YFUeDjAaj1DfJ44BKEeAShWwR}"

psql() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 "$@"; }
psql_t() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -tAc "$@"; }

echo "=== live identity ==="
echo "LIVE_NODE=$LIVE_NODE SELLER=$SELLER LISTING=$SMOKE_LISTING HOTKEY=$HOTKEY"

echo "=== current token auth probe ==="
OLD_KEY="$(grep -E '^PROXYHUB_API_KEY=' config/docker/provider.compose.env 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
OLD_TOML_KEY="$(grep -E '^api_key' config/docker/provider.toml 2>/dev/null | sed -E 's/.*=\s*"?([^"]+)"?.*/\1/' | tr -d '[:space:]' || true)"
probe_key() {
  local k="$1"
  [[ -z "$k" ]] && { echo invalid_empty; return; }
  curl -sS -m 10 -X POST http://127.0.0.1:18080/v1/provider/auth \
    -H 'Content-Type: application/json' \
    -d "{\"token\":\"$k\"}" || echo '{"valid":false,"error":"curl_fail"}'
}
echo "compose_env_auth=$(probe_key "$OLD_KEY")"
echo "toml_auth=$(probe_key "$OLD_TOML_KEY")"

echo "=== seller provider_tokens ==="
psql -c "SELECT id, name, is_active, deleted_at IS NOT NULL AS deleted, expires_at, left(token,12) AS token_prefix, last_used FROM provider_tokens WHERE user_id='$SELLER' ORDER BY created_at DESC NULLS LAST LIMIT 8;"

echo "=== mint fresh token via control-api golang tool in container ==="
# Prefer running provider_dev_token against host DB from a one-shot golang container, OR python HMAC insert.
# Extract TOKEN_HMAC_SECRET + DATABASE_URL from control-api container env.
TOKEN_HMAC_SECRET="$("${COMPOSE[@]}" exec -T control-api printenv TOKEN_HMAC_SECRET | tr -d '\r')"
DATABASE_URL="$("${COMPOSE[@]}" exec -T control-api printenv DATABASE_URL | tr -d '\r')"
# Convert docker-internal DSN to localhost for host-side tools if needed; we mint inside a throwaway container on the compose network.
SIGNING_KEY="$(grep -E '^PROXYHUB_PROVIDER_SIGNING_KEY=' config/docker/provider.compose.env 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
if [[ -z "$SIGNING_KEY" ]]; then
  SIGNING_KEY="$(grep -E '^provider_signing_key' config/docker/provider.toml 2>/dev/null | sed -E 's/.*=\s*"?([^"]+)"?.*/\1/' | tr -d '[:space:]' || true)"
fi

# Mint using python — replicate HashToken (HMAC-SHA256 hex of raw token)
export TOKEN_HMAC_SECRET
RAW_TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
export RAW_TOKEN
HASHED="$(python3 - <<'PY'
import hmac, hashlib, os
secret = os.environ["TOKEN_HMAC_SECRET"].encode()
raw = os.environ["RAW_TOKEN"].encode()
print(hmac.new(secret, raw, hashlib.sha256).hexdigest())
PY
)"
TOKEN_ID="$(python3 - <<'PY'
import uuid
print(str(uuid.uuid4()))
PY
)"
echo "minted token_id=$TOKEN_ID hash_prefix=${HASHED:0:12}"

psql -c "INSERT INTO provider_tokens (id, user_id, token, name, is_active, last_used, created_at, updated_at)
VALUES ('$TOKEN_ID', '$SELLER', '$HASHED', 'ops-wire-connect-$(date -u +%Y%m%dT%H%M%SZ)', true, NOW(), NOW(), NOW());"

# Deactivate older tokens for this user (optional clarity; keep new one active)
psql -c "UPDATE provider_tokens SET is_active=false, updated_at=NOW() WHERE user_id='$SELLER' AND id <> '$TOKEN_ID' AND is_active=true AND deleted_at IS NULL;"

echo "=== auth probe new token ==="
NEW_AUTH="$(probe_key "$RAW_TOKEN")"
echo "new_auth=$NEW_AUTH"
echo "$NEW_AUTH" | grep -qi '"valid"[[:space:]]*:[[:space:]]*true' || {
  echo "FATAL: new token failed auth — HMAC/secret mismatch?"
  # show hash fn length expectations
  echo "secret_len=${#TOKEN_HMAC_SECRET} raw_len=${#RAW_TOKEN} hash_len=${#HASHED}"
  exit 1
}

echo "=== ensure provider_nodes row for LIVE_NODE ==="
EXISTS="$(psql_t "SELECT COUNT(*) FROM provider_nodes WHERE id='$LIVE_NODE';")"
if [[ "$EXISTS" == "0" ]]; then
  echo "creating provider_nodes $LIVE_NODE"
  psql -c "INSERT INTO provider_nodes (id, user_id, name, status, is_healthy, hotkey, connection_type, created_at, updated_at, last_seen_at)
  VALUES ('$LIVE_NODE', '$SELLER', 'ops-wire-connect', 'online', true, '$HOTKEY', 'residential', NOW(), NOW(), NOW());"
else
  psql -c "UPDATE provider_nodes SET deleted_at=NULL, status='online', is_healthy=true, user_id='$SELLER', hotkey=COALESCE(NULLIF(hotkey,''), '$HOTKEY'), last_seen_at=NOW(), updated_at=NOW() WHERE id='$LIVE_NODE';"
fi
psql -c "SELECT id, user_id, status, is_healthy, deleted_at IS NOT NULL AS deleted, left(coalesce(hotkey,''),24) AS hotkey FROM provider_nodes WHERE id='$LIVE_NODE';"

echo "=== ensure nodes mirror ==="
MIRROR="$(psql_t "SELECT COUNT(*) FROM nodes WHERE provider_node_id='$LIVE_NODE';" 2>/dev/null || echo 0)"
if [[ "$MIRROR" == "0" ]]; then
  NEW_NODES_ID="$(python3 - <<'PY'
import uuid; print(str(uuid.uuid4()))
PY
)"
  psql -c "INSERT INTO nodes (id, user_id, provider_node_id, status, is_healthy, created_at, updated_at)
  VALUES ('$NEW_NODES_ID', '$SELLER', '$LIVE_NODE', 'online', true, NOW(), NOW())
  ON CONFLICT DO NOTHING;" 2>/dev/null || \
  psql -c "INSERT INTO nodes (id, provider_node_id, status, is_healthy, created_at, updated_at)
  VALUES ('$NEW_NODES_ID', '$LIVE_NODE', 'online', true, NOW(), NOW());" 2>/dev/null || echo "nodes mirror insert skipped"
else
  psql -c "UPDATE nodes SET deleted_at=NULL, status='online', is_healthy=true, updated_at=NOW() WHERE provider_node_id='$LIVE_NODE';" || true
fi

echo "=== wire listing to LIVE_NODE ==="
# detect column name
COLS="$(psql_t "SELECT string_agg(column_name, ',') FROM information_schema.columns WHERE table_name='proxy_listings';")"
echo "proxy_listings cols sample: ${COLS:0:200}"
if echo "$COLS" | grep -q 'provider_node_id'; then
  psql -c "UPDATE proxy_listings SET provider_node_id='$LIVE_NODE', status='active', updated_at=NOW() WHERE id='$SMOKE_LISTING';"
  psql -c "SELECT id, status, provider_node_id, seller_id FROM proxy_listings WHERE id='$SMOKE_LISTING';"
elif echo "$COLS" | grep -q 'node_id'; then
  psql -c "UPDATE proxy_listings SET node_id='$LIVE_NODE', status='active', updated_at=NOW() WHERE id='$SMOKE_LISTING';"
  psql -c "SELECT id, status, node_id, seller_id FROM proxy_listings WHERE id='$SMOKE_LISTING';"
else
  echo "FATAL: cannot find node column on proxy_listings"
  exit 1
fi

echo "=== write provider.toml + compose.env ==="
export LIVE_NODE SIGNING_KEY
python3 - <<'PY'
from pathlib import Path
import os, re
toml = Path("config/docker/provider.toml")
text = toml.read_text() if toml.exists() else ""
def set_kv(src, key, val):
    pat = re.compile(rf'^{re.escape(key)}\s*=.*$', re.M)
    line = f'{key} = "{val}"'
    if pat.search(src):
        return pat.sub(line, src)
    return src + ("\n" if src and not src.endswith("\n") else "") + line + "\n"
if not text.strip():
    text = """control_api_url = "http://control-api:8080"
gateway_addr = "edge-gateway:3128"
connection_type = "residential"
use_tls = true
tls_skip_verify = true
metrics_port = 9090
"""
raw = os.environ["RAW_TOKEN"]
node = os.environ["LIVE_NODE"]
sign = os.environ.get("SIGNING_KEY", "")
text = set_kv(text, "api_key", raw)
text = set_kv(text, "node_id", node)
if sign.strip():
    text = set_kv(text, "provider_signing_key", sign)
toml.parent.mkdir(parents=True, exist_ok=True)
toml.write_text(text)
env = Path("config/docker/provider.compose.env")
env.write_text(f"""# Generated by ops-wire-provider-connect.sh
PROXYHUB_API_KEY={raw}
PROXYHUB_PROVIDER_SIGNING_KEY={sign}
""")
print("wrote", toml, "and", env)
PY

echo "=== restart provider-node ==="
"${COMPOSE_P[@]}" up -d --force-recreate provider-node
sleep 8
for i in $(seq 1 20); do
  logs="$(docker logs proxyhubb-provider-node --tail 30 2>&1 || true)"
  if echo "$logs" | grep -qiE 'Handshake complete|tunnel established|Connected to Edge Gateway'; then
    echo "TUNNEL_OK try=$i"
    echo "$logs" | tail -20
    break
  fi
  if echo "$logs" | grep -qi 'Invalid or inactive provider token'; then
    echo "still auth failing try=$i"
  fi
  sleep 3
done
docker logs proxyhubb-provider-node --tail 40 2>&1 || true
docker logs proxyhubb-edge-gateway-1 --tail 20 2>&1 | grep -iE 'provider|tunnel|auth|handshake|peer' | tail -15 || true

echo "=== provider_nodes after restart ==="
psql -c "SELECT id, status, is_healthy, deleted_at IS NOT NULL AS deleted, last_seen_at, left(coalesce(hotkey,''),24) FROM provider_nodes WHERE id='$LIVE_NODE';"

echo "LIVE_NODE=$LIVE_NODE"
echo PROVIDER_WIRE_DONE
