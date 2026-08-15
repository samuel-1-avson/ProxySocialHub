#!/usr/bin/env bash
# Wave 5.C.1 — browse registry hard-filter smoke on gcp-testnet.
set -euo pipefail
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"
PSQL=(sudo docker exec -i proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 -tAc)

echo "=== W5.C browse registry filter ==="
mode=$(curl -fsS "$API/v1/listings?limit=1" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("discovery",{}).get("browse_registry_filter",""))')
echo "browse_registry_filter=$mode"
if [[ "$mode" != "enforce" ]]; then
  echo "FAIL: expected browse_registry_filter=enforce (got '$mode')"
  echo "Hint: set PROXYHUB_BROWSE_REGISTRY_FILTER=enforce and recreate control-api"
  exit 2
fi

REG_ID=$("${PSQL[@]}" "
SELECT pl.id::text FROM proxy_listings pl
LEFT JOIN LATERAL (
  SELECT COALESCE(pn.is_registered_on_chain,false) AS reg
  FROM provider_nodes pn
  WHERE pn.deleted_at IS NULL
    AND ((pl.provider_node_id IS NOT NULL AND pn.id = pl.provider_node_id)
         OR (pl.provider_node_id IS NULL AND pn.user_id = pl.seller_id))
  ORDER BY CASE WHEN pl.provider_node_id IS NOT NULL AND pn.id = pl.provider_node_id THEN 0 ELSE 1 END,
           CASE WHEN pn.status='online' THEN 0 ELSE 1 END, pn.last_seen_at DESC NULLS LAST
  LIMIT 1
) pn ON TRUE
WHERE pl.status='active' AND pl.available_bandwidth_gb > 0 AND COALESCE(pn.reg,false)=true
ORDER BY pl.updated_at DESC NULLS LAST LIMIT 1;" | tr -d '[:space:]')

UNREG_ID=$("${PSQL[@]}" "
SELECT pl.id::text FROM proxy_listings pl
LEFT JOIN LATERAL (
  SELECT COALESCE(pn.is_registered_on_chain,false) AS reg
  FROM provider_nodes pn
  WHERE pn.deleted_at IS NULL
    AND ((pl.provider_node_id IS NOT NULL AND pn.id = pl.provider_node_id)
         OR (pl.provider_node_id IS NULL AND pn.user_id = pl.seller_id))
  ORDER BY CASE WHEN pl.provider_node_id IS NOT NULL AND pn.id = pl.provider_node_id THEN 0 ELSE 1 END,
           CASE WHEN pn.status='online' THEN 0 ELSE 1 END, pn.last_seen_at DESC NULLS LAST
  LIMIT 1
) pn ON TRUE
WHERE pl.status='active' AND pl.available_bandwidth_gb > 0 AND COALESCE(pn.reg,false)=false
ORDER BY pl.updated_at DESC NULLS LAST LIMIT 1;" | tr -d '[:space:]')

echo "reg_listing=${REG_ID:-none} unreg_listing=${UNREG_ID:-none}"

if [[ -n "$UNREG_ID" ]]; then
  code=$(curl -sS -o /tmp/w5c-unreg.json -w '%{http_code}' "$API/v1/listings/$UNREG_ID")
  echo "unreg_detail_http=$code"
  if [[ "$code" != "404" ]]; then
    echo "FAIL: unregistered listing detail must 404 under enforce"
    head -c 300 /tmp/w5c-unreg.json; echo
    exit 2
  fi
  UNREG_ID="$UNREG_ID" python3 - <<'PY'
import json, os, urllib.request
uid = os.environ["UNREG_ID"]
api = os.environ.get("CONTROL_API_URL", "http://127.0.0.1:18080")
with urllib.request.urlopen(api + "/v1/listings?limit=100") as r:
    d = json.load(r)
ids = [str(x.get("id", "")) for x in d.get("listings", [])]
if uid in ids:
    raise SystemExit("FAIL: unregistered listing still in browse")
print("unreg_omitted_from_browse=yes")
PY
else
  echo "WARN: no unregistered active listing to negative-test"
fi

if [[ -n "$REG_ID" ]]; then
  code=$(curl -sS -o /tmp/w5c-reg.json -w '%{http_code}' "$API/v1/listings/$REG_ID")
  echo "reg_detail_http=$code"
  [[ "$code" == "200" ]] || { echo "FAIL: registered listing detail"; exit 2; }
fi

curl -fsS "$API/v1/listings?limit=1" | python3 -c 'import json,sys; print("honesty="+json.dumps(json.load(sys.stdin).get("discovery",{})))'
echo "W5C_BROWSE_FILTER_OK"
