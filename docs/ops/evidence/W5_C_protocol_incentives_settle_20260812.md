# Evidence: Wave 5.C.4 protocol incentives dual-gated settle — 2026-08-12

## Verdict

**PASS** — `W5C_INCENTIVES_SETTLE_OK` (unit / dual-gate path).

## Exit claim

`PROXYHUB_PROTOCOL_INCENTIVES=settle` + `PROXYHUB_INCENTIVE_SETTLE_CONFIRM=1`
enables hot-wallet `SendSOL` of the **provider incentive share**; settle without
confirm queues `pending_custody`. Observe mode unchanged. No mint. Gateway/treasury
shares remain ledger-only. gcp defaults stay off/observe.

## Unit proof

```
go test ./internal/incentives/ -count=1
ok  	github.com/proxyhubb/control-api/internal/incentives

# Covered:
# - Mode off|observe|settle + SolSettleArmed dual-gate
# - observe → status=observed
# - settle without CONFIRM → pending_custody + ErrIncentiveAwaitingCustody
# - settle+CONFIRM → SendSOLTestHook → status=settled + tx_hash
# - SettlePendingCustody claims observed → settled
# - StatusMeta mint_enabled=false; sol_transfer only when armed
```

`W5C_INCENTIVES_SETTLE_OK`

## Changes

| Path | Role |
|------|------|
| `incentives/incentives.go` | Mode `settle`, dual-gate, hot-wallet path, `SettlePendingCustody` |
| `models/protocol_incentive_event.go` | `recipient_wallet`, `tx_hash`, `settled_at` |
| `migrations/000148_protocol_incentive_settle.*` | Schema columns |
| `docs/ops/PROTOCOL_INCENTIVES.md` | W5.C.4 flow |
| `docs/ops/WAVE5_DECENTRALIZATION_PLAN.md` | W5.C.4 checklist |

## Non-claims

- Not PHB/PHUBB mint
- Not escrow skim / seller-share rewrite
- Not gateway or treasury-retain auto-pay
- Not on-chain incentive program CPI
- Not enabled on gcp-testnet by default (settle+confirm remain off)
