# Wallet production closure

Checklist to move wallet work from “implemented on branch” to **verified on staging/production**. Phases 1–4 of [`WALLET_IMPLEMENTATION_PLAN.md`](WALLET_IMPLEMENTATION_PLAN.md) are code-complete; this doc is the operational gate.

## Quick automated pass (local / staging)

```powershell
# All automated local gates (no GitHub Actions)
.\scripts\local-verification.ps1

# Or wallet-only:
.\scripts\wallet-production-closure.ps1

# Apply pending SQL migrations first (Docker dev DB)
.\scripts\wallet-production-closure.ps1 -ApplyMigrations
```

```bash
# Linux / macOS / CI-style
chmod +x scripts/wallet-production-closure.sh
PGPASSWORD=proxyhubb ./scripts/wallet-production-closure.sh
```

**Manual E2E helper** (public API + checklist; optional JWT):

```powershell
.\scripts\wallet-manual-e2e.ps1
.\scripts\wallet-manual-e2e.ps1 -AccessToken $env:ACCESS_TOKEN
```

**CI (optional):** `.github/workflows/proxyhubb-ci.yml` when GitHub Actions billing is fixed. For day-to-day verification use `.\scripts\local-verification.ps1` instead of waiting on CI.

Exit code `0` means automated checks passed. You still need **authenticated** steps in [WALLET_E2E_SMOKE.md](WALLET_E2E_SMOKE.md) and [DEV_SOLANA_SMOKE.md](DEV_SOLANA_SMOKE.md).

---

## 1. Migrations (000080–000088)

| Version | Purpose |
|---------|---------|
| `000080` | Withdrawal whitelist, primary address, cooldown timestamp on `wallets` |
| `000081` | `user_flags` table |
| `000082` | Widen explorer numeric columns |
| `000083` | `wallet_ledger_entries.tx_hash` |
| `000084` | Pending tx idempotency key fix |
| `000085` | Provider registry / node link |
| `000086` | Provider nodes base price |
| `000087` | Listing ↔ provider node link |
| `000088` | Drop `balance_usdt`, `paystack_recipient_code`; purge non-SOL `pending_transactions` |

### Apply (Docker)

```powershell
docker compose -f docker-compose.dev.yml build db-migrate control-api web
docker compose -f docker-compose.dev.yml up -d postgres
docker compose -f docker-compose.dev.yml up db-migrate
docker compose -f docker-compose.dev.yml up -d control-api web
```

Staging/production: run the same `db-migrate` job against the target `DATABASE_URL` (never set `AUTO_MIGRATE=true` on normal API replicas).

### Verify

```sql
SELECT version FROM schema_migrations WHERE version >= '000080' ORDER BY version;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'wallets'
  AND column_name IN ('withdrawal_whitelist', 'primary_withdrawal_address', 'withdrawal_address_changed_at');
-- balance_usdt must NOT appear

SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_flags');
```

---

## 2. Environment (SOL-only, treasury, safety)

| Variable | Required | Notes |
|----------|----------|--------|
| `POSTGRES_PASSWORD`, `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `TOKEN_HMAC_SECRET`, `REDIS_PASSWORD` | Yes | Compose dev enforces these |
| `SOLANA_TREASURY_ADDRESS` / `SOLANA_TREASURY_HOT_ADDRESS` | Yes | Deposit recipient |
| Oracle keypair mount | Yes | Payouts sign from oracle, not treasury display address — see [DEV_SOLANA_SMOKE.md](DEV_SOLANA_SMOKE.md) |
| `EMERGENCY_SOL_PRICE_USD` | Yes | Billing fallback when price feeds fail |
| `KYC_WEBHOOK_SECRET` (+ optional IP allowlist) | Prod | Phase 1 KYC hardening |
| `TREASURY_MULTISIG_ADMIN_IDS` | If using 4.2 | Large treasury moves |

**Remove / leave unset (Phase 3):** `PAYSTACK_*`, MoMo/MTN payment env vars. Compose files should not reference them; `.env.example` may still list deprecated keys — do not configure in prod.

**Workers:** reconciliation + anomaly detection should run in the same deployment as `control-api` (see `main.go`).

---

## 3. API smoke (no auth)

| Check | Command | Pass |
|-------|---------|------|
| Liveness | `GET /health` | `status: ok` |
| Solana | `GET /v1/solana/health` | `network`, oracle balance |
| Transparency | `GET /v1/treasury/public` | `oracle_configured`, treasury address |
| UI | http://localhost:3000/treasury | Matches API |

---

## 4. Authenticated wallet smoke

Follow [WALLET_E2E_SMOKE.md](WALLET_E2E_SMOKE.md):

- `GET /v1/wallet/withdrawal-security`
- Deposit → `POST /v1/wallet/deposit/crypto`
- Withdraw ≤10 SOL / >10 SOL with signature
- Whitelist `PUT /v1/wallet/withdrawal-security/whitelist`

Follow [DEV_SOLANA_SMOKE.md](DEV_SOLANA_SMOKE.md) for full devnet path (linked wallet, escrow program id, oracle funded).

---

## 5. Automated tests (CI / local)

```powershell
cd services\control-api
$env:TEST_DATABASE_URL = "postgresql://proxyhubb:proxyhubb@127.0.0.1:5433/proxyhubb_test?sslmode=disable"
$env:EMERGENCY_SOL_PRICE_USD = "200"
go test ./internal/billing/... -count=1
go test ./internal/api/... -count=1 -run 'Wallet|Withdrawal|Whitelist|Cooldown|Crypto|GDPR|Treasury'
```

Test DB: `docker compose -f docker-compose.test.yml up -d` (port **5433**).

---

## 6. Staging sign-off

| Item | Owner | Local dev | Staging / prod |
|------|-------|-----------|----------------|
| Migrations 080–088 applied | Ops | ☐ → run `db-migrate` | ☐ |
| No Paystack/MoMo in compose/env | Ops | ☐ automated in closure script | ☐ |
| Treasury + oracle funded (target network) | Ops | ☐ devnet oracle | ☐ |
| `local-verification.ps1` or closure script green | Eng | ☐ | ☐ |
| `smoke_wallet_api` (auth paths) | Eng | ☐ | ☐ |
| Manual E2E (deposit / withdraw / whitelist) | QA | ☐ browser + devnet | ☐ |
| Solana smoke (treasury public, solana health) | QA | ☐ public API OK | ☐ |
| Provider CLI + registry link | QA | ☐ see PROVIDER_PHASE1_VERIFY | ☐ |
| Monitoring: payout retry queue, circuit breaker | Ops | — | ☐ |

**Local dev:** after `docker compose -f docker-compose.dev.yml up -d`, run `.\scripts\local-verification.ps1` then complete manual rows in [WALLET_E2E_SMOKE.md](WALLET_E2E_SMOKE.md).

---

## Roadmap tracker

Cross-cutting checklist (CI, staging, E2E, registry): [NEXT_STEPS_TRACKER.md](NEXT_STEPS_TRACKER.md).

Provider self-claim UI is on `/dashboard/provider/earnings` (`ProviderClaimPanel`). Seller listings: `/marketplace/manage`.

---

## Related docs

- [WALLET_PHASE1_STATUS.md](WALLET_PHASE1_STATUS.md) — security
- [WALLET_PHASE2_STATUS.md](WALLET_PHASE2_STATUS.md) — tests
- [WALLET_PHASE3_STATUS.md](WALLET_PHASE3_STATUS.md) — fiat removal, workers
- [WALLET_PHASE4_STATUS.md](WALLET_PHASE4_STATUS.md) — treasury, explorer, claim
- [DOCKER_REBUILD.md](DOCKER_REBUILD.md) — image rebuild after migration changes
