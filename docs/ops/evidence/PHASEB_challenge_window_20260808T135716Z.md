# Phase B — Buyer Challenge Window + Auto-Release Gate

| Field | Value |
|-------|--------|
| **Stamp** | 2026-08-08T13:57:16Z |
| **Host** | proxyhubb-testnet |
| **Verdict** | **PASS** |

## What landed

1. **Workers scheduled** in `control-api` `main.go`:
   - `StartEscrowAutoReleaseWorker` (15m) — confirmed log: `AutoRelease worker started (interval=15m)`
   - `StartDisputeExpiryWorker` (1h) — confirmed log: `Dispute expiry worker started`
2. **Auto-release dispute gate** in `AutoReleaseExpiredEscrows`:
   - Blocks when escrow disputed, order disputed, open escrow dispute, or open/voting/review/appealed jury
   - Parks escrow as `disputed` + Warning alert (no settle)
3. **Jury create aligned**: `createDisputeJury` sets escrow → `disputed` in the same DB txn as order transition
4. **Configurable hold**: `PROXYHUB_ESCROW_CHALLENGE_DAYS=7` live on VM (used by `CreateEscrowForOrder`)

## Live checks

| Check | Result |
|-------|--------|
| control-api healthy | yes |
| `PROXYHUB_ESCROW_CHALLENGE_DAYS` | `7` |
| Auto-release worker log | yes |
| Dispute expiry worker log | yes |
| `/health` | 200 |

## Tests

- `TestEscrowChallengeDays` — ok
- `TestAutoReleaseBlockReason_EscrowDisputed` / `_OrderDisputed` — ok

## Next Phase B

Threshold / multisig settle (BC-06): program nonce bump, co-signer wiring, amount-gated route for new large escrows.
