# Evidence: Wave 11.C gateway-bond release client — 2026-08-14

## Verdict

**PASS (in-repo)** — `W11C_RELEASE_CLIENT_OK`.

**Not claimed in this client note:** `live_economic_slash=true`, DePIN.
Live accuse + 3600s wait + `resolve_release` are in
[`W11_C_gateway_bond_release_soak_20260814.md`](W11_C_gateway_bond_release_soak_20260814.md).

## What shipped

`cmd/w8-gateway-bond` and `internal/solana/gateway_bond.go`:

| Command | Gate | Moves stake? |
|---------|------|----------------|
| `accuse` | `CONFIRM_W11C_ACCUSE=1` | no |
| `wait-window` | none (read-only) | no |
| `resolve-release` | `CONFIRM_W11C_RELEASE=1` | no |
| `soak-release` | `CONFIRM_W11C_RELEASE_SOAK=1` | no |

`resolve_slash` is **not** a CLI command. Slash dual-gates must stay **unset**
or the client refuses. `programs/session` rejected. Mainnet rejected.
`live_economic_slash` stays **false**.

`fetch [operator]` now attaches bond + challenge (`resolve_after`,
`window_remaining_secs`).

Script: `scripts/w11c-devnet-release-soak.ps1` (hour-plus wait).

## Tests

`go test ./internal/solana/ -run 'GatewayBond|SlashGates|ChallengeWindow|Accuse'`

## Live fleet

Release soak **PASS** 2026-08-14
([`W11_C_gateway_bond_release_soak_20260814.md`](W11_C_gateway_bond_release_soak_20260814.md)).
GCP slash env stays unset. `live_economic_slash` stays **false**. W10.A
observe continues.

## Non-claims

- Not W11.B multi-org
- Not a usage-challenge soak (that is ADR 0015 / W12.A, docs-only today)
- Not DePIN
