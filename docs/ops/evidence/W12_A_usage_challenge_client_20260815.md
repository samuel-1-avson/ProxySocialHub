# Evidence: Wave 12.A usage-challenge slice 1 client — 2026-08-15

## Verdict

**PASS (in-repo)** — `W12A_USAGE_CHALLENGE_CLIENT_OK`.

**Not claimed:** live usage `accuse` on the public-cluster bond, slash soak,
`live_economic_slash=true`, permissionless buyer-to-chain (slice 2), TEE,
trustless metering, DePIN, `programs/session`.

## Exit claim

A buyer can file an off-chain petition that binds a verified W9.C settlement
receipt to a disputed 32-byte `leaves_hash` and ADR 0015 D1 `evidence_hash`.
The protocol accuser CLI can open `gateway-bond` `accuse` with that hash
(`CONFIRM_W12A_ACCUSE=1`, slash env unset, `slash_bps=1`). Prefer
`resolve_release` via `w8-gateway-bond`. No new program. No HTTP route.

## What shipped

- `internal/settlement` petition + D1 hash
- `cmd/w12a-usage-challenge` (`demo`, `petition`, `verify`, `hash`, `accuse`)
- [`docs/ops/W12_USAGE_CHALLENGE.md`](../W12_USAGE_CHALLENGE.md)
- `scripts/w12a-usage-challenge-client.ps1` / `.sh` (no accuse tx)

Replay:

```
.\scripts\w12a-usage-challenge-client.cmd
```

## Proof (2026-08-15, this laptop)

```
ok  github.com/proxyhubb/control-api/internal/settlement
W12A_USAGE_CHALLENGE_CLIENT_OK
W12A_PETITION_VERIFY_OK
verified=true window_key=w9d-window-1 resolve_path=release
would_broadcast=false live_economic_slash=false slice=1
evidence_hash=af5e9efc8dee13360d5a96d66342849e43bb7e2df11dc779c7d6d8c464cb6235
```

`CONFIRM_W12A_ACCUSE` was unset; the client script refuses if it is `1`.

## Honesty

- Disputes the **claimed** `leaves_hash`, not physical bytes (ADR 0010)
- Slice 1 accuser is still `config.accuser` (ProxyHubb-shaped SPOF)
- A usage challenge that releases is not economic slash
- W11.C tiny bond is **not** re-accused here

## Non-claims

- Not a live public-cluster usage soak
- Not escrow clawback
- Not `resolve_slash`
- Not DePIN
