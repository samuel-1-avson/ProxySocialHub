# Wallet Phase 4 — Advanced Decentralized Features

**Status:** Complete except optional pay streams (4.6 deferred per plan)

## Delivered

| Item | Location |
|------|----------|
| 4.1 Hot/cold treasury | `treasury/addresses.go`, `treasury/treasury_manager.go`, env: `SOLANA_TREASURY_HOT_*`, `SOLANA_TREASURY_COLD_*` |
| 4.2 Multi-sig withdrawals (>100 SOL) | `api/treasury_multisig.go`, `gov/governor.go` |
| 4.3 Public transparency | `GET /v1/treasury/public`, [`apps/web/src/app/treasury/page.tsx`](../apps/web/src/app/treasury/page.tsx) |
| 4.4 Explorer links | `api/solscan.go`; wallet ledger + deposit/withdraw responses; wallet UI + explorer quick nav → Treasury |
| 4.5 Provider self-claim | `api/provider_claim.go`, [`ProviderClaimPanel`](../apps/web/src/components/ProviderClaimPanel.tsx) |
| 4.6 Pay streams | **Deferred** — Streamflow/Zebec not integrated |

## API: explorer fields

Wallet endpoints now include `solscan_url` (and `tx_hash` where applicable):

- `GET /v1/wallet` — transactions with on-chain `tx_hash` / `solscan_url`
- `POST /v1/wallet/deposit/crypto`
- `POST /v1/wallet/withdraw/sol`

Public treasury batch payouts already expose `solscan_url` via `GET /v1/treasury/public`.

## Verify locally

```powershell
# Public treasury (no auth)
curl http://localhost:18080/v1/treasury/public

# UI
# http://localhost:3009/treasury
# http://localhost:3009/explorer → Treasury quick link
# http://localhost:3009/dashboard/wallet → ledger "On-chain" links
```

See also [`docs/TREASURY_4.1_AUDIT.md`](TREASURY_4.1_AUDIT.md) and [`docs/DEV_SOLANA_SMOKE.md`](DEV_SOLANA_SMOKE.md).

## Env (4.1)

```env
SOLANA_TREASURY_HOT_ADDRESS=
SOLANA_TREASURY_COLD_ADDRESS=
SOLANA_TREASURY_HOT_MIN_BALANCE=100
SOLANA_TREASURY_HOT_MAX_BALANCE=500
SOLANA_TREASURY_REPLENISH_AMOUNT=200
```

Cold → hot replenishment above threshold uses admin multi-sig propose/sign flow (4.2).
