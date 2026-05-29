# Treasury 4.1 — Hot/Cold Architecture Audit

**Date:** 2026-05-29  
**Status:** Implemented in code (Phase 4 branch)

## Summary

| Item | Before | After |
|------|--------|-------|
| Operational treasury | Single `SOLANA_TREASURY_ADDRESS` | Hot wallet via `SOLANA_TREASURY_HOT_ADDRESS` (falls back to legacy address) |
| Cold storage | Not modeled | Optional `SOLANA_TREASURY_COLD_ADDRESS` with balance in `GetTreasuryStats` |
| Auto-topup monitor | Legacy thresholds only | Hot min/max/replenish env + alert when hot is low and cold is configured |
| Cold → hot transfer | N/A | Requires **4.2** multi-sig (`POST /v1/treasury/withdrawals/propose`) |

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `SOLANA_TREASURY_ADDRESS` | Legacy / fallback hot address | — |
| `SOLANA_TREASURY_HOT_ADDRESS` | Daily payouts & auto-topup target | Falls back to `SOLANA_TREASURY_ADDRESS` |
| `SOLANA_TREASURY_COLD_ADDRESS` | Long-term storage (90% target) | Optional |
| `SOLANA_TREASURY_HOT_MIN_BALANCE` | Hot low-water mark (SOL) | `100` |
| `SOLANA_TREASURY_HOT_MAX_BALANCE` | Hot target ceiling (SOL) | `500` |
| `SOLANA_TREASURY_REPLENISH_AMOUNT` | Suggested cold→hot size (SOL) | `200` |
| `TREASURY_MULTISIG_ADMIN_IDS` | Comma-separated admin user IDs for 4.2 | Dev: `admin-1,admin-2,admin-3` |

## API surfaces

- `GET /v1/monitoring/treasury` — authenticated stats (includes `hot` / `cold` / `combined_*`)
- `GET /v1/treasury/public` — public transparency payload (4.3)
- `POST /v1/treasury/withdrawals/*` — admin 2-of-3 for withdrawals **> 100 SOL** (4.2)

## Deferred

- **4.6** Solana Pay streams — until production treasury path is stable.
- On-chain Squads cold wallet — off-chain governor + oracle `SendSOL` used for 4.2 MVP.
