# W7.B — Operator manifest bundle (discovery cache)

`GET /v1/gateways/operators` is a **cache** of W6.B signed manifests. A second
copy (file / URL / IPFS CID) can reconstruct the operator set **without**
control-api or Postgres.

## Bundle format

```json
{
  "message_type": "PROXYHUB_OPERATOR_MANIFEST_BUNDLE",
  "version": "1",
  "issued_at": 1700000000,
  "operators": [
    {
      "slug": "edge-b",
      "pubkey": "<base58>",
      "host_id": "gce-w6-operator-b",
      "buyer_base_url": "http://…:8090",
      "tunnel_addrs": ["…:3128"],
      "peer_urls": ["edge-a@http://…:8090"],
      "bonded": true,
      "status": "active",
      "manifest_payload": "PROXYHUB_OPERATOR_MANIFEST:v1:…",
      "manifest_signature": "<base58>",
      "manifest_expires_at": 1700000000
    }
  ]
}
```

Each row verifies with the operator Ed25519 pubkey. The bundle itself is not a
new trust root.

## Export / pin

```
GET /v1/gateways/operators/bundle
```

Save the JSON, pin to IPFS, or copy to an edge host.

## Reconstruct without the API

```bash
go run ./cmd/w7b-manifest-bundle list   operators.json
go run ./cmd/w7b-manifest-bundle verify operators.json
# also accepts https://… or a raw CID (IPFS_GATEWAY)
```

`discovery_sot=bundle` in CLI output. Control-api does not need to be up.

Live `W7B_BUNDLE_VERIFY_OK` claimed 2026-08-13: signed bundle verified on the VM
with `proxyhubb-control-api-1` stopped. HTTP `GET /v1/gateways/operators/bundle`
claimed 2026-08-13 (`W7B_HTTP_BUNDLE_OK`; see
[`evidence/P0_3_host_b_bundle_migration_20260813.md`](evidence/P0_3_host_b_bundle_migration_20260813.md)).

## Edge pin (skips live directory GET)

| Env | Role |
|-----|------|
| `PROXYHUB_OPERATOR_BUNDLE_PATH` | Local JSON file |
| `PROXYHUB_OPERATOR_BUNDLE_URL` | HTTP(S) JSON |
| `PROXYHUB_OPERATOR_BUNDLE_CID` | Fetched via `IPFS_GATEWAY` |

When any of these is set, the edge **does not** call
`GET {CONTROL_API_URL}/v1/gateways/operators/bundle`. Debug: `GET /debug/operators`.

On control-api, the same env vars flip honesty `discovery_sot=postgres_cache`.

## Non-claims

- Not censorship-resistant global discovery
- Platform can still refuse to host a cache
- Not DePIN; Host-B is still the same GCP org until a foreign `org_id` is live (W7.D)
