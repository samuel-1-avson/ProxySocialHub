# M4 journal-as-SoT — W1.5 staged landing

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Result | `M4_JOURNAL_AS_SOT_STAGED` |
| Default | `PROXYHUB_JOURNAL_AS_SOT=false` (wallet still SoT until cutover) |

## What landed

1. Dual-write remains **fail-closed** (journal error aborts Credit/Debit).
2. Flag `PROXYHUB_JOURNAL_AS_SOT` inverts write order: journal first, then
   `wallets.balance_*` as cache ([`wallet_tx.go`](../../../services/control-api/internal/models/wallet_tx.go)).
3. `PROXYHUB_JOURNAL_SHADOW_READ` defaults on when JournalAsSoT is on — use
   existing `ReconcileJournals` Σ2100 vs wallet alerts (`PROXYHUB_JOURNAL_DRIFT_ALERTS=1`).
4. Env documented in `.env.example`.

## Cutover on gcp-testnet (operator)

1. Confirm DB-01 drift = 0 (`DB01_dual_write_harden` evidence).
2. Set `PROXYHUB_JOURNAL_AS_SOT=true` + recreate control-api.
3. Smoke credit/debit + recon green.
4. Keep wallet column as cache; do not drop until read-path consumers audited.

## Non-claims

- Not full COA coverage for every fee/hold path
- Not journal-only reads in all APIs yet
- Not mainnet-ready finance grade
