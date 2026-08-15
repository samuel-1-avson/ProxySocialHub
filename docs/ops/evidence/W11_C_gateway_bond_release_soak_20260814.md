# Evidence: Wave 11.C gateway-bond **release** soak — 2026-08-14

## Verdict

**PASS** — `W11C_ACCUSE_OK` + `W11C_WINDOW_ELAPSED` + `W11C_RELEASE_OK`.

**Not claimed:** `live_economic_slash=true`, slash soak, DePIN, `programs/session`,
multi-org. Slash dual-gates stayed **unset**. GCP was not flipped.

## Exit claim

The existing W8 tiny bond (1_000_000 lamports) was accused, the 3600s
challenge window elapsed, then `resolve_release` closed the challenge
**without** moving stake. Prefer release. `resolve_slash` is not a CLI
command and was not sent.

## On-chain

| Field | Value |
|-------|--------|
| Program | `7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5` |
| Operator / accuser | `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2` |
| Bond PDA | `H9a8FNvtRM5o7TWV9TVeaAvBiGGeXyNajUQ9Pgb8nbcq` |
| Challenge PDA | `JApaFv1qigB9ksEqiooGj9419E48cgu5XUZJQzWzjCYf` |
| Accuse tx | `4ks8M72LXcvYgeTbjW5g2Bhc75AsA9a985LGbHiG7hGLqQ5i3gWyc4UJTFwKLmNSYKW7RryY3geSYVZyLUjPNqhJ` |
| `resolve_after` | unix `1786751014` = 2026-08-14T23:43:34Z |
| `slash_bps` | 1 (release path; not slashed) |
| Evidence hash | `075cbfb6969e6a1c17a67f1b3c6469306a376100c8e52887d6222c20ca18dc70` |
| Release tx | `4ZmyYtDZWRJmRzdYfihxXkzqCPTkhJc6P69JGCzoMTeU7iFshbSdqqo4wdEjqjmzuCUoZQPKP3bLHNWDU2Cio8Mf` |
| Stake after | 1_000_000 lamports |
| `open_challenge` / `accused` / `slashed` | false / false / false |
| `live_economic_slash` | **false** (must stay false after a release soak) |
| RPC | `https://api.devnet.solana.com` |

Replay (slash env **unset**):

```
CONFIRM_W11C_RELEASE_SOAK=1 go run ./cmd/w8-gateway-bond accuse <operator>
go run ./cmd/w8-gateway-bond wait-window <operator>
CONFIRM_W11C_RELEASE_SOAK=1 go run ./cmd/w8-gateway-bond resolve-release <operator>
```

`wait-window` retries RPC refresh failures (public devnet dropped once at
~1285s remaining; resumed). Window elapsed 2026-08-14T23:43:47Z.

Post-release `fetch`: `challenge=missing`, `slash_count=0`,
`slashed_lamports=0`, `bonded=true`.

## GCP

Slash env `PROXYHUB_GATEWAY_SLASH_AUTO` / `PROXYHUB_GATEWAY_SLASH_CONFIRM`
unset. Honesty `live_economic_slash=false`. W10.A observe unchanged.

## Non-claims

- Not a slash soak — do **not** set `live_economic_slash=true`
- Not APY / token yield
- Not W11.B multi-org
- Not `programs/session`
- Not DePIN
