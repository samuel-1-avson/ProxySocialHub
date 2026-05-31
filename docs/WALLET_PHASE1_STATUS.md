# Wallet Phase 1 — Security Lockdown Status

**Plan reference:** [WALLET_IMPLEMENTATION_PLAN.md](./WALLET_IMPLEMENTATION_PLAN.md) (Phase 1)

| Item | Status | Notes |
|------|--------|--------|
| 1.1 Docker Compose secrets (`:?` required) | Done | `docker-compose.dev.yml`, `minimal.yml`, `full.yml` — no hardcoded `PROVIDER_PRIVATE_KEY` fallbacks |
| 1.2 KYC webhook auth (IP + HMAC + timestamp + idempotency) | Done | `services/control-api/internal/api/kyc.go` |
| 1.3 Revenue claim race / idempotency | Done | `circle_pool.go` — Redis `SetNX` + compensating rollback |
| 1.4 Subscription proration in DB transaction | Done | `subscriptions.go` — `db.DB.Transaction` |
| 1.5 Treasury recipient verification on deposits | Done | `escrow_listener.go` — `SOLANA_TREASURY_ADDRESS` check |

## Required env (local / prod)

Set in `.env` before `docker compose up`:

- `POSTGRES_PASSWORD`, `JWT_SECRET`, `REDIS_PASSWORD`
- `PROVIDER_PRIVATE_KEY` (relayer / on-chain paths)
- `KYC_WEBHOOK_SECRET`, `KYC_WEBHOOK_IP_ALLOWLIST` (production KYC webhooks)
- `SOLANA_TREASURY_ADDRESS` (deposit crediting)

## Next (Phase 2+)

Unit test expansion for wallet transfers/withdrawals, withdrawal security migrations (080+), anomaly detector — see implementation plan weeks 2–10.
