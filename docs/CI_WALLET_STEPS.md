# CI wallet steps

Wallet-related gates in [`.github/workflows/proxyhubb-ci.yml`](../.github/workflows/proxyhubb-ci.yml) (workflow name **ProxyHubb CI**). They run on every push/PR to `main` or `develop` when GitHub Actions is healthy.

See also: [WALLET_PRODUCTION_CLOSURE.md](WALLET_PRODUCTION_CLOSURE.md) for local/staging scripts.

## Jobs at a glance

| Job | When it runs | Wallet step |
|-----|----------------|-------------|
| **`db-migrate`** | Every push/PR (no path filter) | **Verify wallet schema (migrations 080-088)** |
| **`backend-test`** | Only if `services/control-api/**` or `proto/**` changed | **Wallet production closure (Go)** |

Other jobs (`frontend-check`, `edge-gateway-check`, `docker-build`, `lint`, etc.) are unchanged.

---

## 1. `db-migrate` — SQL migrations + schema closure

**Purpose:** Prove all `migrations/*.up.sql` apply cleanly on a fresh Postgres 16 DB, then assert the post-088 wallet schema.

**Steps (in order):**

1. **Run all up migrations** — `psql` applies each `migrations/*.up.sql` in sorted order.
2. **Verify key tables** — `wallets`, `sessions`, `nodes`, `provider_tokens`, `spending_records` exist.
3. **Verify wallet schema (080-088)** — checks:
   - `wallets.withdrawal_whitelist`, `primary_withdrawal_address`, `withdrawal_address_changed_at` present
   - `wallets.balance_usdt` **absent** (dropped in `000088`)
   - `user_flags` table exists (`000081`)
   - `wallet_ledger_entries.tx_hash` exists (`000083`)
4. **Down migrations** — best-effort rollback smoke test (`continue-on-error: true`).

**Local equivalent:** `.\scripts\wallet-production-closure.ps1 -ApplyMigrations` or apply migrations then run the SQL checks in the script.

---

## 2. `backend-test` — billing + wallet API tests

**Purpose:** Fast Go regression gate before the full `go test ./...` coverage job.

**Step: Wallet production closure (Go)** — runs after `go build`:

```bash
go test ./internal/billing/... -count=1
go test ./internal/api/... -count=1 -run 'Wallet|Withdrawal|Whitelist|Cooldown|Crypto|GDPR|Treasury'
```

**Environment (CI):** Postgres 15 + Redis service containers; `TEST_DATABASE_URL`, `EMERGENCY_SOL_PRICE_USD=200`, and test JWT/session/encryption secrets (see workflow file).

**Note:** Tests use GORM `AutoMigrate` via `testutil.SetupTestDB`, not the SQL migration files. **`db-migrate`** validates SQL; this step validates Go behavior.

**Local equivalent:**

```powershell
$env:TEST_DATABASE_URL = "postgres://proxyhubb:proxyhubb@127.0.0.1:5433/proxyhubb_test?sslmode=disable"
$env:EMERGENCY_SOL_PRICE_USD = "200"
cd services\control-api
go test ./internal/billing/... -count=1
go test ./internal/api/... -count=1 -run 'Wallet|Withdrawal|Whitelist|Cooldown|Crypto|GDPR|Treasury'
```

Or: `.\scripts\wallet-production-closure.ps1`

---

## Manual CI run

After the workflow rename (see below), trigger from the Actions tab:

**Actions → ProxyHubb CI → Run workflow** (`workflow_dispatch` on `main`).

Or push an empty commit:

```bash
git commit --allow-empty -m "ci: retrigger ProxyHubb CI"
git push origin main
```

---

## Troubleshooting: `startup_failure` / `BuildFailed`

### Symptom

- Run ends in **`startup_failure`** in under a second
- **0 jobs** in the run
- API may show `"path": "BuildFailed"` and a **deleted** workflow id

### Cause (this repo)

GitHub had registered a **ghost workflow** for an old broken `.github/workflows/ci.yml` (`state: deleted`, `path: BuildFailed`). Pushes kept targeting that id instead of the active workflow file, so the real **ProxyHubb CI** workflow never started.

### Fix applied

- Renamed workflow file to **`proxyhubb-ci.yml`**
- Changed workflow **`name:`** to **`ProxyHubb CI`**
- Added `workflow_dispatch`, top-level **`permissions`**, and **`GO_VERSION: '1.25'`** (matches `go.mod`)

### If Actions still does not run

1. **Settings → Actions → General** — Actions enabled; workflow permissions allowed.
2. **Settings → Billing** — private repos need Actions minutes (free tier includes a monthly allowance).
3. Confirm the new workflow appears under **Actions** as **ProxyHubb CI** (not an empty **BuildFailed** entry).
4. Check [GitHub Status](https://www.githubstatus.com/) for platform incidents.
5. Optional: **Settings → Actions → General** — disable Actions, save, re-enable (clears stuck queue on some repos).

### Verify registration (CLI)

```bash
gh api repos/OWNER/REPO/actions/workflows --jq '.workflows[] | {id,name,path,state}'
```

Expect **`proxyhubb-ci.yml`** with `state: active`. A `BuildFailed` / `deleted` entry may remain in history but should no longer receive new pushes.

---

## Related workflows

| File | Triggers | Wallet-related |
|------|----------|----------------|
| `proxyhubb-ci.yml` | push, PR, manual | **Yes** (steps above) |
| `security.yml` | push, PR, weekly cron | Go vuln scan only |
| `deploy.yml` | tags `v*`, manual | No |
