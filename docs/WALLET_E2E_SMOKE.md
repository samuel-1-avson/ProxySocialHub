# Wallet security — migrations & manual smoke

## 1. Apply migrations (staging / dev)

Migrations live in repo root [`migrations/`](../migrations/):

| Version | Purpose |
|---------|---------|
| `000080` | `withdrawal_whitelist`, `primary_withdrawal_address`, `withdrawal_address_changed_at` on `wallets` |
| `000081` | `user_flags` table |
| `000082` | Widen explorer numeric columns |

**Docker (recommended):**

Rebuild so the image includes migrations `000080`–`000082` and the latest API (see [DOCKER_REBUILD.md](./DOCKER_REBUILD.md)):

```bash
docker compose -f docker-compose.dev.yml build db-migrate control-api web
docker compose -f docker-compose.dev.yml up db-migrate
docker compose -f docker-compose.dev.yml up -d
```

Ensure `POSTGRES_PASSWORD`, `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `TOKEN_HMAC_SECRET`, and `REDIS_PASSWORD` are set in `.env`.

**Verify columns:**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'wallets'
  AND column_name IN ('withdrawal_whitelist', 'primary_withdrawal_address', 'withdrawal_address_changed_at');
```

## 2. Manual API smoke (linked wallet required)

Prerequisites: user logged in, Solana wallet linked (Phantom/Solflare), treasury configured (`GET /v1/system/config/public` → `treasury_solana`).

| Step | Action | Expected |
|------|--------|----------|
| A | `GET /v1/wallet/withdrawal-security` | `withdrawal_whitelist`, `primary_withdrawal_address`, cooldown flags |
| B | Send SOL to treasury → `POST /v1/wallet/deposit/crypto` with `amount`, `tx_hash`, `chain: solana` | Balance increases |
| C | Withdraw **≤ 10 SOL** via UI or `POST /v1/wallet/withdraw/sol` `{ "amount": 1 }` | `200`, `tx_hash` or on-chain failure with balance restored |
| D | Withdraw **> 10 SOL** without signature | `403` signature required |
| E | Withdraw **> 10 SOL** after signing `withdraw:<nonce>:<amount>` in wallet | `200` or on-chain error with refund |
| F | `PUT /v1/wallet/withdrawal-security/whitelist` with addresses (include primary) | `200` |
| G | Withdraw to non-whitelisted primary (if whitelist excludes linked) | `403` whitelist / destination error |
| H | `GET /v1/audit/anomalies` (or security settings UI) | Wallet flags visible when anomaly worker fires |

UI path: **Dashboard → Financial HQ** → Fund Movement + **Linked Wallets** → Withdrawal whitelist.

## 3. Automated tests (CI / local)

```powershell
cd services\control-api
$env:TEST_DATABASE_URL = "host=127.0.0.1 user=proxyhubb password=proxyhubb dbname=proxyhubb_test port=55432 sslmode=disable"
go test ./internal/models/... ./internal/api/... -count=1 -run 'Withdrawal|Whitelist|Cooldown|GDPR'
go test ./...
```
