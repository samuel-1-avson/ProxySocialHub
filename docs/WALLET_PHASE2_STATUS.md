# Wallet Phase 2 — Test Coverage Status

**Goal:** >80% coverage on financial mutation paths (see `docs/WALLET_IMPLEMENTATION_PLAN.md` Phase 2).

## Added in this pass

### API (`internal/api/`)

| Test | File | Notes |
|------|------|--------|
| `TestTransferP2P_SameWallet` | `wallet_phase2_test.go` | Blocks transfers when both users share the same linked Solana address |
| `TestTransferP2P_ConcurrentTransfers` | `wallet_phase2_test.go` | Two parallel transfers; asserts final sender balance |
| `TestTransferP2P_OnChainFallback` | `wallet_phase2_test.go` | Sync on-chain settlement + `SendSOLTestHook` failure → compensating refund |
| `TestWithdrawSOL_Success` | `wallet_phase2_test.go` | `sendSOLOnChainHook` mock; balance deducted |
| `TestWithdrawSOL_OnChainFailureCompensates` | `wallet_phase2_test.go` | Hook failure → `withdrawal_failed_refund` ledger |
| `TestWithdrawSOL_SpendingLimitExceeded` | `wallet_phase2_test.go` | Daily limit on withdraw path |
| `TestVerifyCryptoDeposit_InvalidChain` | `crypto_test.go` | Unsupported chain → 400 |
| `TestVerifyCryptoDeposit_TxNotFound` | `crypto_test.go` | RPC `null` result → 400 |
| `TestVerifyCryptoDeposit_CreditsOnChainAmount` | `crypto_test.go` | Credits verified on-chain amount, not client `amount` |

Existing coverage retained in `wallet_test.go`, `wallet_withdrawal_security_test.go`, `crypto_test.go` (success, double-spend, sender mismatch).

### Models (`internal/models/spending_limit_test.go`)

- `TestCheckSpendingLimit_WithinLimit`
- `TestCheckSpendingLimit_ExceedsMonthly`
- `TestCheckSpendingLimit_WindowReset`
- `TestRecordSpending_Atomic`

### Billing (`internal/billing/worker_test.go`)

- `TestCreditProviderWallet_Atomic`

## Test hooks (production-safe)

- `sendSOLOnChainHook` — mock treasury payout in withdraw tests
- `solana.SendSOLTestHook` — mock P2P on-chain `SendSOL`
- `solana.SetOracleClientForTest` — non-nil oracle stub
- `testP2PSettleSynchronously` — run P2P settlement inline in tests

## Run locally

Tests need a running Postgres. They **skip** (not fail) if nothing listens on the configured host/port.

### Option A — test compose (port **5433**)

```powershell
cd F:\project\proxyhubb
docker compose -f docker-compose.test.yml up -d postgres

$env:TEST_DATABASE_URL = "postgresql://proxyhubb:proxyhubb@127.0.0.1:5433/proxyhubb_test?sslmode=disable"
cd services\control-api
go test ./internal/api/... -run "TransferP2P_|WithdrawSOL_|VerifyCryptoDeposit_" -count=1 -v
go test ./internal/models/... -run "CheckSpendingLimit|RecordSpending" -count=1 -v
go test ./internal/billing/... -run "CreditProviderWallet" -count=1 -v
```

### Option B — main dev compose (port **55432** default)

```powershell
cd F:\project\proxyhubb
docker compose up -d postgres
# testutil defaults: host 127.0.0.1 port 55432 user/password proxyhubb, db proxyhubb_test
cd services\control-api
go test ./internal/api/... -run "TransferP2P_|WithdrawSOL_|VerifyCryptoDeposit_" -count=1 -v
```

Create `proxyhubb_test` once if using the main DB user/database from dev:

```powershell
docker compose exec postgres psql -U proxyhubb -c "CREATE DATABASE proxyhubb_test;"
```

## Still optional (plan §2.5)

Full billing worker matrix (`SettleUsage`, circuit breaker, payout retry) remains for a follow-up if not already covered elsewhere in `worker_test.go`.
