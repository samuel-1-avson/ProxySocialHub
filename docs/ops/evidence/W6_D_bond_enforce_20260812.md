# Evidence: Wave 6.D bond-enforce + slash design — 2026-08-12

## Verdict

**PASS** — `W6D_BOND_OK` (unit + design). Live economic slash **not** claimed.

## Exit claim

`PROXYHUB_GATEWAY_OPERATOR_BOND_ENFORCE=off|observe|enforce` (default off).
Slash path designed; `programs/session` explicitly rejected.

## Unit proof

```
BondEnforceMode default off
observe does not omit unbonded
enforce / true aliases omit unbonded
HonestyMeta.live_economic_slash=false
HonestyMeta.programs_session=unsafe_do_not_deploy
```

`W6D_BOND_OK`

## Design

[`GATEWAY_OPERATOR_SLASH.md`](../GATEWAY_OPERATOR_SLASH.md): accuse → challenge
window → custody audit. Dual-gate future transfer; confirm without a safe
bonded-gateway program is still a no-op.

Slash-audit API still writes `slashing_events` with `tx_hash=""` and
`slash_percentage=0`.

## Non-claims

- Not live on-chain slash
- Not DePIN APY
- Not `programs/session` deploy
