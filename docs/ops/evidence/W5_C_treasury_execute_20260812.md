# Evidence: Wave 5.C.3 treasury dual-gated hot-wallet execute — 2026-08-12

## Verdict

**PASS** — `W5C_TREASURY_EXECUTE_OK` (unit / dual-gate path).

## Exit claim

`PROXYHUB_GOV_TREASURY_AUTO_SPEND` + `PROXYHUB_GOV_TREASURY_EXECUTE_CONFIRM=1`
enables real hot-wallet `SendSOL` for passed treasury proposals; otherwise
`pending_custody`. Not on-chain proposal→treasury PDA CPI. gcp-testnet defaults stay off.

## Unit proof

```
go test ./internal/decentralization/ -run "GovTreasury|GovernanceAutonomy"
ok  	github.com/proxyhubb/control-api/internal/decentralization

go test ./internal/governance/ -run "Treasury|HotWallet"
ok  	github.com/proxyhubb/control-api/internal/governance

# Covered:
# - unarmed → pending_custody + ErrTreasuryAwaitingCustody
# - AUTO_SPEND without CONFIRM=1 → still custody
# - dual-gated → SendSOLTestHook → status=executed + tx_hash
```

`W5C_TREASURY_EXECUTE_OK`

## Changes

| Path | Role |
|------|------|
| `decentralization/mode.go` | Dual gates + `GovTreasuryHotWalletExecuteArmed` + honesty meta |
| `governance/executor.go` | Unarmed → `pending_custody`; armed → hot-wallet `SendSOL` |
| `governance/executor_treasury_test.go` | Custody / single-gate / dual-gate tests |
| `docs/ops/GOVERNANCE_AUTONOMY.md` | W5.C.3 flow |
| `docs/adr/0009-governance-autonomy.md` | D2 updated for dual-gated hot spend |

## Non-claims

- Not on-chain proposal → treasury PDA CPI
- Not token-weighted DAO treasury autonomy
- Not enabled on gcp-testnet by default (both gates remain off)
- Hot wallet ≠ cold Squads / multisig custody replacement
