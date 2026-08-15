# Evidence: Wave 9.D Host-A API-down reconstruct — 2026-08-14

## Verdict

**PASS** — `W9D_API_DOWN_RECONSTRUCT_OK` on Host-A (`proxyhubb-testnet`)
with `CONFIRM_W9D_STOP_API=1`.

**Not claimed:** shop-without-ProxyHubb, checkout without API, DePIN,
`programs/session`, live ListingCommitment PDAs.

## Exit claim

While `proxyhubb-control-api-1` was **stopped**, the laptop-emitted listing
and settlement fixtures verified, and the W10.D pinned operator bundle
**listed** from disk (`/opt/proxyhubb/ops/operators-bundle.json`). Restore
used `docker start` (not compose recreate, not `--remove-orphans`) so
W10.A `observe` and W6 `GATEWAY_OP_A_HOST_ID` stayed.

## Replay

```
CONFIRM_W9D_STOP_API=1 CONTROL_API_URL=http://127.0.0.1:18080 \
  bash /tmp/gcp-host-a-w9d-stop-api.sh
```

Bins: `/tmp/w9d-bin/{w9b-listing-bundle,w9c-settlement-bundle,w7b-manifest-bundle}`
(linux/amd64). Fixtures: `/tmp/w9d-fixtures/`.

## Live proof (Host-A, 2026-08-14T23:00Z)

```
api_up=1
api_down=1
edge-a host_id=gce-proxyhubb-testnet verified=false unsigned
edge-b host_id=gce-w6-operator-b verified=false unsigned
count=2 discovery_sot=bundle
pinned_bundle_listed=1 unsigned_same_org=1
count=1 catalog_source=bundle
W9B_BUNDLE_VERIFY_OK
verified=true settlement_sot=postgres would_broadcast=false
W9C_SETTLEMENT_RECEIPT_OK
session_capability=observe
gateway_op_a=gce-proxyhubb-testnet
W9D_API_DOWN_RECONSTRUCT_OK
```

First attempt failed because `w7b-manifest-bundle verify` rejects the
unsigned W10.D pin. Trap restored the API. Script then **lists** the pin
(count≥1) and **verifies** listing + settlement only. Slash env was not
touched. `live_economic_slash` stays false.

The pin was signed on 2026-08-15
([`W6_B_operator_manifest_signed_20260815.md`](W6_B_operator_manifest_signed_20260815.md)),
so a re-run of this soak can now `verify` the operator bundle too.

## Honesty

`catalog_source=bundle` for CLI reconstruct  
`on_chain=false` on the listing fixture  
`would_broadcast=false`  
`discovery_sot=bundle` for the pin list  
`operator_org_diversity` still `same_org`  
`PROXYHUB_SESSION_CAPABILITY=observe` after start

## Non-claims

- Not “buyers can shop without ProxyHubb”
- Not replacing `GET /v1/listings` merchandising
- Not a signed foreign-org bundle
- Not DePIN
- Not `programs/session`
