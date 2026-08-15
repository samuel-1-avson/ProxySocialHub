# Evidence: Wave 11.A operator issuers — 2026-08-14

## Verdict

**PASS (in-repo)** — `W11A_BUNDLE_ISSUER_CODE_OK`.

**Not claimed:** live `session_mint=operator_capability`, live operator-minted
CONNECT, W11.B multi-org, DePIN.

W10.A capability observe on Host-A J2 edge-b and Host-B stays **on** through
**2026-08-21**. This change is not rolled to the soak fleet in this pack.

## What shipped

Canonical bytes were already `PROXYHUB_SESSION_CAPABILITY:v1` (W7.A).

Edge allowlist is now:

1. `PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY` (comma-separated, platform)
2. **Verified** pubkeys from the pinned operator bundle snapshot

Unverified bundle rows are skipped. Empty allowlist still fails closed.

Operators mint with existing `cmd/w7a-capability-sign` using the operator
`signing_key`. Control-api may still mint.

Honesty (`SessionCapabilityMeta`):

| Condition | Label |
|-----------|--------|
| capability observe + HMAC | `session_mint=control_api_hmac` |
| capability enforce | `session_mint=capability_token` |
| enforce **and** `PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT` | `session_mint=operator_capability` |
| bundle pin set | `session_capability_issuer=operators_and_control_api` |
| no pin | `session_capability_issuer=control_api` |

`PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT` does not change CONNECT by itself.

## Tests

- `services/edge-gateway`: `verified_issuer_pubkeys_skips_unverified`,
  `session_capability_valid_bundle_operator_issuer`,
  `capability_token_admits_verified_bundle_issuer`
- `services/control-api/internal/decentralization`: `TestSessionCapabilityMode`
  (observe must not claim `operator_capability`)

Recorded 2026-08-14: Go `ok`; cargo `3 passed` (`session_capability_valid_bundle_operator_issuer`,
`capability_token_admits_verified_bundle_issuer`,
`verified_issuer_pubkeys_skips_unverified`).

## Live fleet (unchanged)

- `session_capability_mode=observe`
- `session_mint=control_api_hmac`
- Bundle pin from W10.D remains
- Do not set `PROXYHUB_SESSION_CAPABILITY=enforce` or
  `PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT` on GCP until the W10.A written
  decision
- Do not arm slash gates

## Docs

- ADR 0013 D5 addendum
- `docs/ops/W7_SESSION_CAPABILITY.md`
- WAVE10 W11.A checkboxes (soak honesty left open)

## Non-claims

- Host-B still `same_org` (not org 2)
- Not permissionless join
- Not a live operator-issued CONNECT soak
- Not DePIN
