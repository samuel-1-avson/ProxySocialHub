# Evidence: Host-A control-api roll — 2026-08-17

## Verdict

**PASS** — `HOST_A_CONTROL_API_ROLL_OK`.

Operator waived the 2026-08-21 W10.A calendar. Capability stayed
`observe`. Slash dual-gates unset. Listing commitment stayed off.
`live_economic_slash=false`. `operator_org_diversity=same_org`.
Not enforce. Not operator mint. Not DePIN.

W10.A observe **restarts** at this binary swap. Week-1 kill-API (2026-08-14)
does not cover this image. Next kill-API is on this roll, not the 08-14
binary.

## Images

| | Value |
|-|-------|
| Pre-roll | `sha256:58eeb9a6101da85866a16b656fd6443b0a61cc1e6f5c834066332c410a4479c7` (created 2026-08-15T06:58:38Z) |
| Rollback tag | `proxyhubb-control-api:pre-roll-20260817` |
| Post-roll | `sha256:802ffaafb20084a47c8cb3d1eafa9c7aa2e3bb5a17a3215d6e572f4348157907` (created 2026-08-17T14:50:23Z) |

Bond preflight: `challenge=missing`, stake 1_000_000, `slashed=false`.

Compose: `docker-compose.yml` + `testnet` + `gcp-testnet` +
`w6-host-a-private.yml` + `w10-observe.yml`. Recreate warned about J2 /
redis-ha orphans; **`--remove-orphans` was not passed**.

## Drift probe (running `/server`)

```
present  listing commitment registered on-chain
present  operators_and_control_api
present  bonded_gateway_program
```

`PROXYHUB_USAGE_CHALLENGE` is **MISSING** on `/server` (slice 1 lives in
`cmd/w12a-usage-challenge`, not the API binary). That is expected.

## Env after swap

```
PROXYHUB_SESSION_CAPABILITY=observe
GATEWAY_OP_A_HOST_ID=gce-proxyhubb-testnet
GATEWAY_OP_B_HOST_ID=gce-w6-operator-b
PROXYHUB_GATEWAY_SLASH_AUTO=unset
PROXYHUB_GATEWAY_SLASH_CONFIRM=unset
PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT=unset
PROXYHUB_LISTING_COMMITMENT=unset   # public honesty listing_commitment_mode=off
```

`/health` `{"status":"ok"}`. Pinned bundle: `verified=2 failed=0`
(`W7B_BUNDLE_VERIFY_OK`).

## Public honesty (fetched 2026-08-17 after roll)

```
session_capability_mode=observe
session_mint=control_api_hmac
session_capability_issuer=operators_and_control_api
remaining_spof=control_api_hmac_and_redis
listing_commitment_mode=off
live_economic_slash=false
operator_org_diversity=same_org
operator_host_diversity=two_hosts
bonded_gateway_program=localnet_soak
```

Issuer label moved because the bundle pin is configured. HMAC still admits
CONNECT. `BondedGatewayProgramHonesty()` is still hardcoded
`localnet_soak` even though the tiny bond is on **devnet** — the field is
present; the string is conservative, not a live-slash claim.

## Non-claims

- Not the 08-21 stay-observe / enforce / revert record
- Not `PROXYHUB_LISTING_COMMITMENT=observe`
- Not `programs/session`
- Not a slash soak
