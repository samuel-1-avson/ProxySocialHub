# Evidence: Wave 9.D API-down catalog reconstruct — 2026-08-13

## Verdict

**PASS** — `W9D_API_DOWN_RECONSTRUCT_OK` (local; control-api unreachable).

Live GCP `docker stop proxyhubb-control-api-1` **not** claimed. Checkout / new
orders may still need the API. Not a storefront without ProxyHubb.

## Exit claim

A pinned listing-commitment bundle verifies with `w9b-listing-bundle
list|verify` while `GET /v1/listings` is unreachable. Optional settlement
receipt verify also succeeds. Merchandising and order creation stay on the API.

## Live proof (laptop soak, 2026-08-13)

Control-api URL was `http://127.0.0.1:1` (nothing listening). Emit did not
use Postgres. Verify did not use control-api.

```
api_down=1
12345678-1234-1234-1234-123456789abc hash=abab… pda= on_chain=false verified=true
count=1 catalog_source=bundle
ok 12345678-1234-1234-1234-123456789abc
verified=1 failed=0 catalog_source=bundle
W9B_BUNDLE_VERIFY_OK
verified=true settlement_sot=postgres would_broadcast=false
W9C_SETTLEMENT_RECEIPT_OK
W9D_API_DOWN_RECONSTRUCT_OK
```

Replay:

```
CONTROL_API_URL=http://127.0.0.1:1 bash scripts/gcp-smoke-sprint-w9d-api-down-catalog.sh
```

Host-A container stop remains gated: `CONFIRM_W9D_STOP_API=1` on the VM.

## Honesty

`catalog_source=bundle` for CLI reconstruct  
`on_chain=false` (W9.A live PDA still absent)  
`would_broadcast=false`  
`programs_session=unsafe_do_not_deploy`  
GCP public API was **not** stopped

## Non-claims

- Not “buyers can shop without ProxyHubb”
- Not replacing `GET /v1/listings` merchandising
- Not live GCP API-down (no `docker stop` on host-A)
- Not live ListingCommitment PDAs
- Not DePIN
- Not `programs/session`
