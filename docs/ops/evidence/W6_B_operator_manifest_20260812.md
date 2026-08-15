# Evidence: Wave 6.B operator-signed manifests — 2026-08-12

## Verdict

**PASS** — `W6B_MANIFEST_OK` (unit). gcp default `PROXYHUB_OPERATOR_MANIFEST=off`.

## Exit claim

Discovery rows can carry an Ed25519 operator manifest (canonical bytes + expiry).
`observe` annotates `manifest_verified`; `enforce` omits invalid/unsigned/expired.
Directory hosting stays centralized.

## Unit proof

```
go test ./internal/gateways/ -count=1
# SignAndVerifyManifest, expired reject, enforce drops unsigned
```

`W6B_MANIFEST_OK`

## Changes

| Path | Role |
|------|------|
| `gateways/manifest.go` | Canonical bytes, sign, verify, modes |
| `GET /v1/gateways/operators` | `manifest` + `manifest_verified` |
| `PROXYHUB_OPERATOR_MANIFEST` | `off\|observe\|enforce` |
| Seed | `GATEWAY_OP_*_SIGNING_KEY` optional |

## Non-claims

- Not censorship-resistant discovery
- Not on-chain operator PDA
- Default off on gcp-testnet
