# Gateway operator slash — Wave 6.D design

Tied to [ADR 0007 appendix](../adr/0007-multi-operator-gateways.md) and
[ADR 0012](../adr/0012-independent-gateway-operators.md).

## Exit claim

Bond-enforce can hide unbonded operators. Slash is implemented in undeployed
`programs/gateway-bond` (Wave 8) with a challenge window. **Live on-chain slash
is not claimed.** Must not use unsafe `programs/session`.

## Bond-enforce modes

| `PROXYHUB_GATEWAY_OPERATOR_BOND_ENFORCE` | Behavior |
|------------------------------------------|----------|
| `off` (default) | List all active operators |
| `observe` | List all; honesty exposes mode; unbonded still visible |
| `enforce` | Omit `bonded=false` from discovery + tunnel registry |

gcp-testnet stays `off` until dual-host registry is green.

## Challenge window (reuse Phase B)

```
accuse (honeytoken / dispute evidence)
  → challenge_window (hold; no transfer)
    → resolve: release | custody slash audit
```

- Accuse today: `POST /v1/gateway/slash-audit` → `slashing_events` row,
  `slash_percentage=0`, empty `tx_hash` (observe).
- Window: reuse escrow hold + auto-release patterns
  (`PHASEB_challenge_window_20260808T135716Z.md`).
- Resolve: **custody** record only until `programs/gateway-bond` is deployed
  and a live soak is claimed. Dual-gate any future transfer:
  `PROXYHUB_GATEWAY_SLASH_AUTO` + `PROXYHUB_GATEWAY_SLASH_CONFIRM=1`.
  Both default unset. Confirm without a **deployed** bonded program is still a
  no-op (audit row only).

## Explicit reject: `programs/session`

`programs/session` remains **unsafe / undeployed** (unconstrained
`complete_session` / `slash_gateway`). Wave 6.D **must not** deploy it or
treat it as the slash vehicle.

Future live slash needs a dedicated bonded-gateway program with:

- Operator stake PDA
- Accuse/challenge accounts
- Admin+timelock or jury — not an unconstrained oracle complete

Wave 8 implements that program at [`programs/gateway-bond`](../../programs/gateway-bond)
(ADR [`0014`](../adr/0014-bonded-gateway-slash.md)). Localnet soak
`W8D_BOND_SLASH_OK` (2026-08-13). Devnet observe bond claimed 2026-08-14.
W11.C **client** can accuse / wait / `resolve_release` (`CONFIRM_W11C_*`);
live release soak unclaimed. GCP execute is still off. Dual-gate:

| Env | Role |
|-----|------|
| `PROXYHUB_GATEWAY_SLASH_AUTO` | truthy to arm |
| `PROXYHUB_GATEWAY_SLASH_CONFIRM` | must be exactly `1` |
| `PROXYHUB_GATEWAY_BOND_PROGRAM_ID` | optional; **must not** be session `8TP21…` |

Both gates + undeployed program ⇒ honesty `gateway_slash_execute=gates_armed_undeployed`
and **no broadcast**. `live_economic_slash` stays false until a live soak is
claimed (`W8.D`, `CONFIRM_W8_DEPLOY=1` — not a deploy tool in the unit smoke).

There is **no** `slash_gateway` instruction on the bonded program.

## Non-claims

- Not live economic slash (Wave 8 program exists, undeployed)
- Not DePIN staking APY
- Not mainnet
- Honeytoken hits remain audit theater until the bonded program is **deployed** and a soak is claimed
- Never deploy `programs/session`
