# Evidence: Wave 10.D operator bundle pin — 2026-08-14

## Verdict

**PASS** — `W10D_BUNDLE_PINNED_FILE` + `W10D_DISCOVERY_SOT_OK` +
`W10_PHASE_A_HOST_B_OK`.

HTTP export was already live (`W7B_HTTP_BUNDLE_OK`). This soak **pins** the
bundle on Host-A J2 edge-b, Host-A control-api, and Host-B.

## Pin

| Host | Env | Path |
|------|-----|------|
| Host-A control-api | `PROXYHUB_OPERATOR_BUNDLE_PATH` | `/etc/proxyhubb/operators-bundle.json` |
| Host-A edge-b | same | same bind from `/opt/proxyhubb/ops/operators-bundle.json` |
| Host-B edge-b | same | `/opt/proxyhubb/ops/operators-bundle.json` |

Bundle: `message_type=PROXYHUB_OPERATOR_MANIFEST_BUNDLE`, `n=2`.

## Honesty

```
discovery_sot=postgres_cache
operator_bundle.path set
operator_org_diversity=same_org
```

Postgres remains the merchandising catalog. The pin is a reconstruct cache,
not global discovery.

## Follow-up

The rows pinned here were **unsigned** (`verify` failed, `list` worked).
Signed 2026-08-15:
[`W6_B_operator_manifest_signed_20260815.md`](W6_B_operator_manifest_signed_20260815.md).

## Non-claims

- Host-B still `same_org` (not W7.D)
- Not IPFS CID pin
- Not DePIN
