# Evidence: Wave 7.B discovery as manifest cache — 2026-08-12

## Verdict

**PASS** — `W7B_DISCOVERY_CACHE_OK` (unit) and live `W7B_BUNDLE_VERIFY_OK` (2026-08-13).

## Exit claim

`GET /v1/gateways/operators` is a cache of W6.B signed manifests. A portable
bundle (JSON array of payload+sig) reconstructs operators from a file/URL/CID
**without Postgres or control-api**. Edge skips the live directory GET when a
bundle pin is set.

## Unit proof

```
go test ./internal/gateways/ -count=1
# BuildAndVerifyBundle_noPostgres, tamper drop, LoadBundleFile, discovery_sot=postgres_cache

go run ./cmd/w7b-manifest-bundle verify testdata/operators.json
# (generated in tests via TempDir; CLI uses the same VerifyBundleEntries)

cargo test operator_bundle -- --nocapture
# canonical_manifest_matches_control_api, verify_operator_local_ed25519
```

`W7B_DISCOVERY_CACHE_OK`

Control-api down does not prevent `w7b-manifest-bundle list|verify` on a pinned file.

## Live proof (2026-08-13T10:00Z, `proxyhubb-testnet`)

Signed a foreign-org bundle on the VM, stopped `proxyhubb-control-api-1`, verified
without Postgres/API:

```
api_down=1
ok edge-ext
verified=1 failed=0 discovery_sot=bundle
W7B_BUNDLE_VERIFY_OK
```

HTTP `GET /v1/gateways/operators/bundle` was **not** claimed (live binary still
routes `:id` for `bundle` until that handler file is redeployed). CLI reconstruct
is the Wave 7.B exit.

## Changes

| Path | Role |
|------|------|
| `gateways/bundle.go` | Bundle format, parse, verify, `discovery_sot` |
| `GET /v1/gateways/operators/bundle` | Export snapshot |
| `GET /v1/gateways/operators` honesty | `discovery_sot=postgres\|postgres_cache` |
| `cmd/w7b-manifest-bundle` | Verify/list without API |
| `edge-gateway/src/operator_bundle.rs` | Pin file/URL/CID; skip live GET |
| `GET /debug/operators` | Edge snapshot |

## Non-claims

- Not censorship-resistant discovery
- Not DePIN
- Default: no bundle pin (API still Postgres-primary)
- IPFS pin is optional; file/URL is enough for the reconstruct path
- HTTP `GET /v1/gateways/operators/bundle` not claimed (live route still `:id`)
- CLI reconstruct with API down is the Wave 7.B live exit
