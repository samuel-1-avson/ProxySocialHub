# Wallet Phase 3 — Cleanup & Decentralized Hardening

**Status:** Complete (May 2026)

## Delivered

| Item | Notes |
|------|--------|
| 3.1 Fiat removal | `paystack.go` / relayer `payout.go` already removed; MTN config dropped; env + compose cleaned; migration `000088` drops `balance_usdt`, `paystack_recipient_code`, non-SOL `pending_transactions` |
| 3.2 Panic recovery | `recoverHandlerPanic` — no raw panic values to clients (`wallet`, `crypto` handlers) |
| 3.3 Referral tx | `CreditReferralReward` commit/rollback already correct |
| 3.4 Compensating refund | Withdraw path uses `alerts.Send`; P2P on-chain failure now transactional refund + critical alert |
| 3.5 Withdrawal security | Migration `000080`, cooldown + large-withdrawal signature |
| 3.6 Reconciliation | Hourly `ReconcileUserWallets` in `treasury/reconciliation.go` |
| 3.7 Anomaly detection | `worker/anomaly_detector.go` + `user_flags` (`000081`) |
| 3.8 GeoIP | HTTPS `ip-api.com` (see `geoip/resolver.go`) |

## Migration

Apply with your usual migrate flow:

```bash
# Example: golang-migrate or project script
migrate -path migrations -database "$DATABASE_URL" up
```

`000088_remove_fiat_wallet_artifacts.up.sql` is idempotent (`IF EXISTS` / safe deletes).

## Verify

```powershell
cd services\control-api
go build ./...
go test ./internal/api/... -run "TransferP2P_|WithdrawSOL_|VerifyCryptoDeposit_" -count=1
```

Use test Postgres on port **5433** (`docker-compose.test.yml`) with `TEST_DATABASE_URL` set (see `docs/WALLET_PHASE2_STATUS.md`).
