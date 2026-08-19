#!/usr/bin/env bash
# Cache a foreign operator bundle in Host-A Postgres.
# Does NOT recreate or restart control-api (W10.A soak stays).
# Does NOT store signing_key. Does not set GATEWAY_OP_*_SIGNING_KEY.
#
#   bash /tmp/gcp-w7d-cache-foreign-operator.sh /tmp/operators-ext.json
set -euo pipefail
BUNDLE="${1:-/tmp/operators-ext.json}"
PLATFORM_ORG="${PROXYHUB_PLATFORM_ORG_ID:-gen-lang-client-0022105784}"
API="${CONTROL_API_URL:-http://127.0.0.1:18080}"

[[ -f "$BUNDLE" ]] || { echo "FAIL: missing $BUNDLE"; exit 2; }
if grep -q signing_key "$BUNDLE"; then
  echo "FAIL: bundle file still contains signing_key"
  exit 2
fi

python3 - "$BUNDLE" "$PLATFORM_ORG" <<'PY' | sudo docker exec -i proxyhubb-postgres-1 \
  psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1
import json, sys

path, platform = sys.argv[1], sys.argv[2]
raw = json.load(open(path))
ops = raw.get("operators") if isinstance(raw, dict) else None
if not ops:
    sys.stderr.write("FAIL: bundle has no operators\n")
    sys.exit(2)
op = ops[0]
org = (op.get("org_id") or "").strip()
if not org or org.lower() == platform.lower():
    sys.stderr.write("FAIL: org_id %r is platform; refuse cache\n" % org)
    sys.exit(2)
if (op.get("slug") or "") in ("edge-a", "edge-b"):
    sys.stderr.write("FAIL: refuse to overwrite platform slugs\n")
    sys.exit(2)

def lit(s):
    return "'" + str(s).replace("'", "''") + "'"

def arr(xs):
    xs = xs or []
    parts = []
    for x in xs:
        x = str(x).replace("\\", "\\\\").replace('"', '\\"')
        parts.append('"' + x + '"')
    return lit("{" + ",".join(parts) + "}")

exp = op.get("manifest_expires_at")
if exp:
    exp_sql = "to_timestamp(%d)" % int(exp)
else:
    exp_sql = "NOW() + interval '30 days'"

display = (op.get("display_name") or op.get("slug") or "edge-ext").strip()
bonded = "TRUE" if op.get("bonded", True) else "FALSE"
status = (op.get("status") or "active").strip() or "active"

print("BEGIN;")
print(
    "INSERT INTO gateway_operators ("
    "slug, display_name, pubkey, buyer_base_url, health_url, "
    "tunnel_addrs, peer_urls, host_id, org_id, "
    "manifest_payload, manifest_signature, manifest_expires_at, "
    "bonded, status, updated_at"
    ") VALUES ("
    f"{lit(op['slug'])}, {lit(display)}, {lit(op['pubkey'])}, "
    f"{lit(op['buyer_base_url'])}, {lit(op.get('health_url') or '')}, "
    f"{arr(op.get('tunnel_addrs'))}::text[], {arr(op.get('peer_urls'))}::text[], "
    f"{lit(op.get('host_id') or '')}, {lit(org)}, "
    f"{lit(op.get('manifest_payload') or '')}, {lit(op.get('manifest_signature') or '')}, "
    f"{exp_sql}, {bonded}, {lit(status)}, NOW()"
    ") ON CONFLICT (slug) DO UPDATE SET "
    "display_name = EXCLUDED.display_name, "
    "pubkey = EXCLUDED.pubkey, "
    "buyer_base_url = EXCLUDED.buyer_base_url, "
    "health_url = EXCLUDED.health_url, "
    "tunnel_addrs = EXCLUDED.tunnel_addrs, "
    "peer_urls = EXCLUDED.peer_urls, "
    "host_id = EXCLUDED.host_id, "
    "org_id = EXCLUDED.org_id, "
    "manifest_payload = EXCLUDED.manifest_payload, "
    "manifest_signature = EXCLUDED.manifest_signature, "
    "manifest_expires_at = EXCLUDED.manifest_expires_at, "
    "bonded = EXCLUDED.bonded, "
    "status = EXCLUDED.status, "
    "updated_at = NOW() "
    "WHERE gateway_operators.slug NOT IN ('edge-a','edge-b') "
    "AND COALESCE(NULLIF(gateway_operators.org_id,''), %s) IS DISTINCT FROM %s;"
    % (lit(platform), lit(platform))
)
print(
    "SELECT slug, org_id, host_id, left(pubkey,12) AS pub12, "
    "length(coalesce(manifest_signature,'')) AS sig_len "
    "FROM gateway_operators ORDER BY slug;"
)
print("COMMIT;")
PY

echo "=== honesty (no control-api restart) ==="
python3 - "$API" <<'PY'
import json, sys, urllib.request
api = sys.argv[1]
with urllib.request.urlopen(api + "/v1/system/config/public", timeout=15) as r:
    d = json.load(r)
g = d.get("gateway_operators") or {}
print("operator_org_diversity=" + str(g.get("operator_org_diversity")))
print("operator_host_diversity=" + str(g.get("operator_host_diversity")))
print("platform_org_id=" + str(g.get("platform_org_id")))
print("session_capability_mode=" + str((d.get("session_capability") or {}).get("session_capability_mode")))
print("listing_commitment_mode=" + str(d.get("listing_commitment_mode") or (d.get("listing_commitments") and "nested")))
print("live_economic_slash=" + str(d.get("live_economic_slash")))
if g.get("operator_org_diversity") != "multi_org":
    sys.exit(2)
print("W7D_PG_CACHE_OK")
PY
