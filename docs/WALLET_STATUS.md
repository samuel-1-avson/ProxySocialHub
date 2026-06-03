# Wallet system — implementation status

**Production checklist:** [WALLET_PRODUCTION_CLOSURE.md](./WALLET_PRODUCTION_CLOSURE.md)  
**Local verification:** [MANUAL_DEVNET_SESSION.md](./MANUAL_DEVNET_SESSION.md), [STAGING_ENFORCE_RUNBOOK.md](./STAGING_ENFORCE_RUNBOOK.md)

## Phase 1 — Security lockdown (complete)

| Item | Status | Notes |
|------|--------|--------|
| Docker Compose secrets (`:?` required) | Done | No hardcoded `PROVIDER_PRIVATE_KEY` fallbacks in compose variants |
| KYC webhook auth (IP + HMAC + timestamp) | Done | `internal/api/kyc.go` |
| Revenue claim race / idempotency | Done | `circle_pool.go` — Redis `SetNX` |
| Subscription proration in DB transaction | Done | `subscriptions.go` |
| Treasury recipient verification on deposits | Done | `escrow_listener.go` |

Required env: `POSTGRES_PASSWORD`, `JWT_SECRET`, `REDIS_PASSWORD`, `PROVIDER_PRIVATE_KEY`, `KYC_WEBHOOK_SECRET`, `SOLANA_TREASURY_ADDRESS`.

## Phase 2 — Test coverage (substantial)

Added/retained tests in `wallet_phase2_test.go`, `crypto_test.go`, `wallet_test.go`, `spending_limit_test.go`, `billing/worker_test.go` — P2P transfer, withdraw compensating refunds, deposit verification, spending limits.

Run:

```powershell
cd services\control-api
go test ./internal/api/... -run "TransferP2P_|WithdrawSOL_|VerifyCryptoDeposit_" -count=1
```

Use test Postgres on port **5433** (`docker-compose.test.yml`) with `TEST_DATABASE_URL` when isolating DB tests.

## Phase 3 — Cleanup & decentralized hardening (complete)

Fiat removal (Paystack/MTN), panic recovery on wallet handlers, withdrawal security migrations (`000080+`), reconciliation worker, anomaly detector, GeoIP HTTPS resolver. Migration `000088` removes fiat wallet artifacts.

## Phase 4 — Advanced decentralized features (complete except 4.6)

| Item | Status |
|------|--------|
| 4.1 Hot/cold treasury | Done — `treasury/addresses.go`, env `SOLANA_TREASURY_*` |
| 4.2 Multi-sig withdrawals (>100 SOL) | Done — `treasury_multisig.go` |
| 4.3 Public transparency | Done — `GET /v1/treasury/public`, `/treasury` UI |
| 4.4 Explorer / Solscan links | Done — `solscan.go`, wallet UI |
| 4.5 Provider self-claim | Done — `provider_claim.go`, `ProviderClaimPanel` |
| 4.6 Pay streams | **Deferred** |

See [TREASURY_4.1_AUDIT.md](./TREASURY_4.1_AUDIT.md), [DEV_SOLANA_SMOKE.md](./DEV_SOLANA_SMOKE.md).
