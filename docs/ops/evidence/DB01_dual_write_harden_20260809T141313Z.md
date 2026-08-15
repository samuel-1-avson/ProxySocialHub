# DB-01 dual-write harden — 20260809T141313Z

**Result:** `DB01_DUAL_WRITE_HARDEN_PASS`

| Field | Value |
|-------|-------|
| Host | `proxyhubb-testnet` |
| Mode | APPLY |
| Journals applied | 1 |
| Residual per-wallet 2100 drift | **0** |
| Global `Σ2100 + Σbalances` | **0** |
| Wallet mutation | none (journal append only) |
| SoT | `wallets.balance_lamports` (unchanged) |
| M4 journal-as-SoT | still open |

## What ran

1. Skip-site allowlist test: `services/control-api/internal/models/journal_skip_sites_test.go`
2. Dry-run then apply: `scripts/ops-db01-journal-backfill.sh --apply`
3. Re-enable alerts: `PROXYHUB_JOURNAL_DRIFT_ALERTS=1` + control-api recreate (`scripts/ops-db01-enable-journal-drift-alerts.sh`)

## Before → after

| Metric | Before | After |
|--------|-------:|------:|
| Global diff (lamports) | 7598112047 (~7.598 SOL) | 0 |
| Drifted wallets | 1 (`fe793802-…`) | 0 |

Adjusting journal: `db01-backfill-fe793802-7249-423c-a502-780b6a5d48f8-20260809T141313Z`  
`entry_type=db01_dual_write_backfill` — Dr `1000` / Cr `2100` for 7598112047 lamports.

## Scope honesty

- Dual-write **consistent** with wallet SoT; recon paging restored.
- Not full double-entry product mapping; not journal-as-SoT (M4).
- DB-01 status: **PARTIAL↑** (not FIXED).
