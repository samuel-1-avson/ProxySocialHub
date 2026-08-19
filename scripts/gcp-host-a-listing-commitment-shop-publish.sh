#!/usr/bin/env bash
# One shop POST /v1/listings to prove listing_commitment_sync wrote a PDA.
# Requires PROXYHUB_LISTING_COMMITMENT=observe. Oracle pays rent (devnet).
# Never slash gates. Never programs/session. Not a merchandised catalog row.
#
#   CONFIRM_W10B_SHOP_PUBLISH=1 \
#     SIGN_BIN=/tmp/provider_sign_listing PDA_BIN=/tmp/w9a-listing-commitment \
#     bash /tmp/gcp-host-a-listing-commitment-shop-publish.sh
set -euo pipefail
if [[ "${CONFIRM_W10B_SHOP_PUBLISH:-}" != "1" ]]; then
  echo "REFUSE: set CONFIRM_W10B_SHOP_PUBLISH=1 on Host-A"
  exit 2
fi
ROOT="${PROJECT_DIR:-/opt/proxyhubb}"
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"
CTR=proxyhubb-control-api-1
PROGRAM_ID="${SOLANA_PROGRAM_ID:-AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu}"
SESSION_ID="8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb"
SIGN_BIN="${SIGN_BIN:-/tmp/provider_sign_listing}"
RPC="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
KEYGEN="${KEYGEN:-}"
[[ -x /tmp/w9d-bin/w7d-operator-join ]] && KEYGEN=/tmp/w9d-bin/w7d-operator-join
[[ -z "$KEYGEN" && -x /tmp/w7-bin/w7d-operator-join ]] && KEYGEN=/tmp/w7-bin/w7d-operator-join

[[ "$PROGRAM_ID" != "$SESSION_ID" ]] || { echo "REFUSE: programs/session"; exit 2; }
[[ -x "$SIGN_BIN" ]] || { echo "FAIL: missing $SIGN_BIN"; exit 2; }
[[ -n "$KEYGEN" ]] || { echo "FAIL: missing w7d-operator-join"; exit 2; }

echo "=== W10.B shop publish → listing_commitment_sync ==="
mode=$(sudo docker exec "$CTR" printenv PROXYHUB_LISTING_COMMITMENT | tr -d '\r')
cap=$(sudo docker exec "$CTR" printenv PROXYHUB_SESSION_CAPABILITY | tr -d '\r')
echo "PROXYHUB_LISTING_COMMITMENT=$mode"
echo "PROXYHUB_SESSION_CAPABILITY=$cap"
[[ "$mode" == "observe" ]] || { echo "FAIL: listing mode $mode"; exit 2; }
[[ "$cap" == "observe" ]] || { echo "FAIL: capability $cap"; exit 2; }
slash_auto=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_AUTO 2>/dev/null || true)
slash_confirm=$(sudo docker exec "$CTR" printenv PROXYHUB_GATEWAY_SLASH_CONFIRM 2>/dev/null || true)
if [[ -n "${slash_auto:-}" || -n "${slash_confirm:-}" ]]; then
  echo "FAIL: slash dual-gate is set"
  exit 2
fi

echo "--- free listing quota from prior W10B soaks ---"
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 -c \
  "update proxy_listings set status='deleted', updated_at=now() where title like 'SOAK W10B listing sync%' and status <> 'deleted';"

echo "--- ensure PG mirror columns ---"
sudo docker exec -i proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE proxy_listings
    ADD COLUMN IF NOT EXISTS listing_commitment_pda VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS listing_commitment_on_chain BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS listing_commitment_tx VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS listing_commitment_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_proxy_listings_commitment_on_chain
    ON proxy_listings (listing_commitment_on_chain)
    WHERE listing_commitment_on_chain = TRUE;
SQL

SELLER=$(sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc \
  "select user_id::text from provider_nodes where coalesce(gateway_node_id,'') <> '' order by last_seen_at desc nulls last limit 1" | tr -d '[:space:]')
[[ -n "$SELLER" ]] || { echo "FAIL: no seller with a provider node"; exit 2; }
GW=$(sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc \
  "select coalesce(gateway_node_id,'') from provider_nodes where user_id='$SELLER' and coalesce(gateway_node_id,'') <> '' limit 1" | tr -d '[:space:]')
echo "seller=$SELLER gateway_node_id=$GW"

umask 077
"$KEYGEN" keygen > /tmp/w10b-shop-key.json
SEED=$(python3 - <<'PY'
import json
from pathlib import Path
k=json.loads(Path("/tmp/w10b-shop-key.json").read_text())
assert k.get("signing_key") and k.get("pubkey")
print(k["signing_key"])
PY
)
PUB=$(python3 - <<'PY'
import json
from pathlib import Path
k=json.loads(Path("/tmp/w10b-shop-key.json").read_text())
print(k["pubkey"])
PY
)
shred -u /tmp/w10b-shop-key.json 2>/dev/null || rm -f /tmp/w10b-shop-key.json
echo "soak_provider_pubkey=$PUB"

NODE_ID=$(sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc \
  "insert into provider_nodes (id, user_id, name, hotkey, gateway_node_id, status, country, protocol, created_at, updated_at)
   values (gen_random_uuid(), '$SELLER', 'w10b-listing-sync-soak', '$PUB', '$GW', 'offline', 'US', 'http', now(), now())
   returning id::text;" | grep -E '^[0-9a-fA-F-]{36}$' | head -n1)
[[ -n "$NODE_ID" ]] || { echo "FAIL: could not insert soak provider_node"; exit 2; }
echo "soak_provider_node=$NODE_ID"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TITLE="SOAK W10B listing sync $STAMP"
python3 - "$NODE_ID" "$TITLE" <<'PY' > /tmp/w10b-listing.json
import json, sys
print(json.dumps({
  "title": sys.argv[2],
  "description": "listing_commitment_sync soak; do not buy",
  "provider_node_id": sys.argv[1],
  "proxy_type": "residential",
  "protocol": "http",
  "rotation_type": "static",
  "country": "US",
  "isp": "soak",
  "price_per_gb": 2.5,
  "min_purchase_gb": 1,
  "available_bandwidth_gb": 1,
  "max_concurrency": 1,
  "status": "active",
}))
PY
"$SIGN_BIN" -signing-key "$SEED" -provider-node-id "$NODE_ID" -gateway-node-id "$GW" \
  -input /tmp/w10b-listing.json -output /tmp/w10b-listing.signed.json
unset SEED
rm -f /tmp/w10b-listing.json

SECRET=$(sudo docker exec "$CTR" sh -c 'printenv JWT_SECRET || printenv SUPABASE_JWT_SECRET' | tr -d '\r' | head -n1)
TOKEN=$(SECRET="$SECRET" USER_ID="$SELLER" python3 - <<'PY'
import os,time,hmac,hashlib,base64,json
sec=os.environ["SECRET"].encode(); uid=os.environ["USER_ID"]
b64=lambda d: base64.urlsafe_b64encode(d).rstrip(b"=").decode()
h=b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
p=b64(json.dumps({"sub":uid,"user_id":uid,"role":"provider","exp":int(time.time())+3600},separators=(",",":")).encode())
s=b64(hmac.new(sec,f"{h}.{p}".encode(),hashlib.sha256).digest())
print(f"{h}.{p}.{s}")
PY
)
BEFORE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CODE=$(curl -sS -o /tmp/w10b-listing-resp.json -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d @/tmp/w10b-listing.signed.json \
  "$API/v1/listings")
echo "publish_http=$CODE"
if [[ "$CODE" != "201" && "$CODE" != "200" ]]; then
  echo "FAIL: publish HTTP $CODE"
  head -c 800 /tmp/w10b-listing-resp.json; echo
  exit 2
fi
python3 - <<'PY'
import json,sys
from pathlib import Path
raw=Path("/tmp/w10b-listing-resp.json").read_text()
print(raw[:800])
d=json.loads(raw)
if "id" not in d:
    sys.exit(2)
print("listing_id="+d["id"])
print("offer_hash="+str(d.get("listing_offer_hash") or ""))
print("offer_verified="+str(d.get("listing_offer_verified")))
print("signer="+str(d.get("listing_offer_signer") or ""))
PY
LISTING_ID=$(python3 -c 'import json;from pathlib import Path; print(json.loads(Path("/tmp/w10b-listing-resp.json").read_text())["id"])')
OFFER_HASH=$(python3 -c 'import json;from pathlib import Path; d=json.loads(Path("/tmp/w10b-listing-resp.json").read_text()); print(d.get("listing_offer_hash") or "")')
SIGNER=$(python3 -c 'import json;from pathlib import Path; d=json.loads(Path("/tmp/w10b-listing-resp.json").read_text()); print(d.get("listing_offer_signer") or "")')
[[ -n "$OFFER_HASH" && -n "$SIGNER" ]] || { echo "FAIL: publish response missing offer hash/signer"; python3 -c 'import json;from pathlib import Path; print(sorted(json.loads(Path("/tmp/w10b-listing-resp.json").read_text()).keys()))'; exit 2; }

echo "--- wait for async register ---"
ok=0
for i in $(seq 1 36); do
  ROW=$(sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc \
    "select coalesce(listing_commitment_on_chain,false)::text||' '||coalesce(listing_commitment_pda,'')||' '||coalesce(listing_commitment_tx,'') from proxy_listings where id='$LISTING_ID'" | tr -d '\r')
  echo "try=$i pg=$ROW"
  echo "$ROW" | grep -q '^t ' && { ok=1; break; }
  echo "$ROW" | grep -q '^true ' && { ok=1; break; }
  LOGS=$(sudo docker logs "$CTR" --since "$BEFORE" 2>&1 | grep -F 'listing commitment' | grep -v 'INSERT INTO "proxy_listings"' || true)
  echo "$LOGS" | grep -F 'listing commitment registered on-chain' >/dev/null && { ok=1; break; } || true
  if echo "$LOGS" | grep -qiE 'panic \(non-fatal\)|listing_commitment.go:'; then
    echo "FAIL: register goroutine panicked"
    echo "$LOGS" | tail -n 20
    exit 2
  fi
  sleep 5
done
LOG=$(sudo docker logs "$CTR" --since "$BEFORE" 2>&1 | grep -F 'listing commitment registered on-chain' | tail -n 3 || true)
echo "log_line=$LOG"
echo "--- commitment logs ---"
sudo docker logs "$CTR" --since "$BEFORE" 2>&1 | grep -F 'listing commitment' | grep -v 'INSERT INTO "proxy_listings"' | tail -n 20 || true

PG_PDA=$(sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc \
  "select coalesce(listing_commitment_pda,'') from proxy_listings where id='$LISTING_ID'" | tr -d '[:space:]')
PG_TX=$(sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc \
  "select coalesce(listing_commitment_tx,'') from proxy_listings where id='$LISTING_ID'" | tr -d '[:space:]')
PG_ON=$(sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc \
  "select listing_commitment_on_chain::text from proxy_listings where id='$LISTING_ID'" | tr -d '[:space:]')
echo "pg_on_chain=$PG_ON pg_pda=$PG_PDA pg_tx=$PG_TX"

if [[ -n "$PG_PDA" ]]; then
  ACC=$(curl -sS "$RPC" -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$PG_PDA\",{\"encoding\":\"base64\"}]}" || true)
  echo "$ACC" | python3 -c 'import json,sys
raw=sys.stdin.read()
try:
  v=json.loads(raw)["result"]["value"]
  print("rpc_account_present="+("true" if v else "false"))
except Exception as e:
  print("rpc_account_present=unknown")
'
fi

[[ "$PG_ON" == "t" || "$PG_ON" == "true" || -n "$LOG" ]] || { echo "FAIL: no PG mirror and no register log"; exit 2; }

echo "--- soak listings are not catalog (status=deleted) ---"
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 -c \
  "update proxy_listings set status='deleted', updated_at=now() where title like 'SOAK W10B listing sync%' and status <> 'deleted';"

echo "listing_id=$LISTING_ID"
echo "offer_hash=$OFFER_HASH"
echo "signer=$SIGNER"
echo "pda=$PG_PDA"
echo "tx=$PG_TX"
echo "W10B_LISTING_COMMITMENT_SHOP_PUBLISH_OK"
echo "not a catalog; delist stays platform; slash off; capability observe; not DePIN"
rm -f /tmp/w10b-listing.signed.json
