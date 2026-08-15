# Evidence: Wave 8.A bonded-gateway program — 2026-08-13

## Verdict

**PASS** — `W8A_BOND_PROGRAM_OK` (unit). Live deploy / live economic slash
**not** claimed.

## Exit claim

A dedicated program (`programs/gateway-bond`) can lock operator stake, open an
accuse, and will not move lamports until a minimum 3600s challenge window
elapses. There is no `slash_gateway` instruction. `programs/session` stays
undeployed. Control-api dual-gate (`PROXYHUB_GATEWAY_SLASH_AUTO` +
`PROXYHUB_GATEWAY_SLASH_CONFIRM=1`) still **no-ops** because the program is not
deployed. Honesty `live_economic_slash=false`.

## Unit proof

```
go test ./internal/solana/ ./internal/gateways/ -count=1 -run 'GatewayBond|SlashGate|SlashExecute|HonestyMeta|SlashLamports'
# session program id rejected
# dual-gate requires AUTO + CONFIRM=1
# SlashWouldBroadcast always false
# PDA seeds deterministic
# slash math matches stake * bps / 10000
# honesty live_economic_slash=false even when gates armed

cargo test --manifest-path programs/gateway-bond/Cargo.toml -- --nocapture
# slash_lamports half/full/overflow
# window_elapsed
# config_windows_ok rejects <3600s (instant slash)
# auto_release_at is 2× window
```

`W8A_BOND_PROGRAM_OK`

Placeholder program ID (Anchor scaffold, **do not deploy**):
`Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS` — **replaced** in W8.D by
`7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5` (localnet soak).

## Changes

| Path | Role |
|------|------|
| `programs/gateway-bond` | Stake PDA + challenge window + rent floor |
| `solana/gateway_bond.go` | PDA derive, dual-gate, session-id reject |
| `gateways/slash_gates.go` | Honesty `gateway_slash_execute` |
| `POST /v1/gateway/slash-audit` | Still observe; names bonded program |
| `cmd/w8-gateway-bond` | id / pda / gates |
| ADR [`0014`](../../adr/0014-bonded-gateway-slash.md) | Decision |
| [`WAVE8_DECENTRALIZATION_PLAN.md`](../WAVE8_DECENTRALIZATION_PLAN.md) | Plan |

## Non-claims

- Not deployed (no `CONFIRM_W8_DEPLOY=1` soak)
- Not live economic slash
- Not DePIN / staking APY
- Not `programs/session`
- Not W7.D foreign org
- Placeholder `declare_id!` replaced in W8.D (`7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5`)
