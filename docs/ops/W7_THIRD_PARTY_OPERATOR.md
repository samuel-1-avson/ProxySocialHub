# W7.D — Third-party operator (org boundary)

Host-B (`proxyhubb-w6-edge-b`) is still GCP project `gen-lang-client-0022105784`.
That is **two hosts, one org**. It does not satisfy W7.D.

W7.D is an operator **outside that org** who:

1. Generates their own Ed25519 key (seed never sent to ProxyHubb)
2. Signs a W6.B manifest locally
3. Publishes pubkey + signed bundle; control-api is a **cache**
4. ProxyHubb seed/env **cannot rotate** that pubkey

Not permissionless join. Not DePIN.

## Honesty

`GET /v1/system/config/public` → `gateway_operators` and
`GET /v1/gateways/operators` → `honesty`:

| Field | Values |
|-------|--------|
| `operator_org_diversity` | `same_org` (default) \| `multi_org` |
| `platform_org_id` | `PROXYHUB_PLATFORM_ORG_ID` (default `gen-lang-client-0022105784`) |
| `foreign_operator_key_rotation` | `operator_only` |

`multi_org` requires at least one row whose `org_id` differs from the platform
org. Empty `org_id` counts as platform.

## Foreign operator (their machine)

```bash
cd services/control-api

# 1. Key stays on the operator host.
go run ./cmd/w7d-operator-join keygen > operator-key.json
# signing_key is secret. pubkey is public.

# 2. Sign a manifest. org_id must NOT be the platform GCP project.
python3 - <<'PY' | go run ./cmd/w7d-operator-join sign > operator-join.json
import json
key = json.load(open("operator-key.json"))
print(json.dumps({
  "signing_key": key["signing_key"],
  "slug": "edge-ext",
  "org_id": "ext-operator-org-1",
  "host_id": "vps-ext-1",
  "buyer_base_url": "http://203.0.113.50:8090",
  "health_url": "http://203.0.113.50:8090/health",
  "tunnel_addrs": ["203.0.113.50:3128"],
  "peer_urls": ["edge-a@http://10.0.0.1:8090"],
  "bonded": True,
}))
PY

# 3. Publish only pubkey + bundle (not signing_key).
python3 -c 'import json; print(json.dumps(json.load(open("operator-join.json"))["bundle"], indent=2))' > operators-ext.json
go run ./cmd/w7b-manifest-bundle verify operators-ext.json
```

Give ProxyHubb `operators-ext.json` (or a URL/CID). Pin it:

```
PROXYHUB_OPERATOR_BUNDLE_PATH=/etc/proxyhubb/operators-ext.json
# or PROXYHUB_OPERATOR_BUNDLE_URL / PROXYHUB_OPERATOR_BUNDLE_CID
```

Optional directory cache: insert a `gateway_operators` row with the **same**
`org_id` + `pubkey` from the bundle. Do **not** set `GATEWAY_OP_*_SIGNING_KEY`
for that slug. Seed will not overwrite a foreign pubkey.

## Platform (ProxyHubb)

- Keep `GATEWAY_OP_A_ORG_ID` / `GATEWAY_OP_B_ORG_ID` unset or equal to
  `PROXYHUB_PLATFORM_ORG_ID`. Host-B stays `same_org`.
- Do not put a foreign operator's seed in control-api env.
- Migration `000151_gateway_operator_org` adds `org_id`.

## Live smoke (optional)

A volunteer/external VPS is the org-boundary proof. Gated:

```
CONFIRM_W7D_EXTERNAL_VPS=1 ./scripts/gcp-smoke-sprint-w7d-third-party-operator.sh
```

Without that env, the script only checks keygen → sign → bundle verify
(`W7D_JOIN_CLI_OK`). Live foreign VPS is **unclaimed** (2026-08-13:
`W7D_EXTERNAL_VPS_SKIPPED` — no volunteer); Host-B remains `same_org`.
Wave 7 A–C live: [`evidence/W7_CLAIMED_20260813.md`](evidence/W7_CLAIMED_20260813.md).
P0.3 Host-B Wave 7 roll + HTTP bundle + `000151`:
[`evidence/P0_3_host_b_bundle_migration_20260813.md`](evidence/P0_3_host_b_bundle_migration_20260813.md).

## Non-claims

- Not DePIN
- Not permissionless join
- Control-api may still refuse to cache a bundle
- Session mint issuer may still be control-api (W7.A/C)
- No live bonded slash (Wave 8)
