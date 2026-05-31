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

When account/billing allows runners (see troubleshooting B), trigger from the Actions tab:

**Actions → ProxyHubb CI → Run workflow** (`workflow_dispatch` on `main`).

Or push an empty commit:

```bash
git commit --allow-empty -m "ci: retrigger ProxyHubb CI"
git push origin main
```

---

## Troubleshooting: `startup_failure` / `BuildFailed`

There are **two separate issues** on this repo (May 2026). Fix both.

### A. Push runs hit a ghost `BuildFailed` workflow

**Symptom:** Push events create a run with `"path": "BuildFailed"`, empty name, **workflow_id `243457783`**, `state: deleted`, **0 jobs**.

**Cause:** An old invalid `.github/workflows/ci.yml` left a deleted workflow registration. GitHub still queued **push** events against that id.

**Fix applied in repo:**

- Renamed CI workflow to **`proxyhubb-ci.yml`**, display name **`ProxyHubb CI`**
- Active workflow id is now **`286491384`** (verify with CLI below)

Push may still show a **BuildFailed** run in the list until GitHub drops the ghost subscription. Ignore those runs; look for **ProxyHubb CI** or use **workflow_dispatch**.

### B. All workflows fail before any job starts (account / billing)

**Symptom:** Even **CI diagnostic** (single `echo` step) or **ProxyHubb CI** via **Run workflow** ends in **`startup_failure`** with **0 jobs**, but the run correctly shows `path: .github/workflows/proxyhubb-ci.yml` and name **ProxyHubb CI**.

**Cause:** This is **not** the wallet YAML steps — GitHub never assigns a runner. Common causes for **private** repos:

| Check | Where |
|--------|--------|
| Actions minutes exhausted / spending limit | [Settings → Billing](https://github.com/settings/billing) → Plans and usage → Actions |
| Actions disabled for private repos | Settings → Actions → General (user or org) |
| Org policy blocks GitHub-hosted runners | Org → Settings → Actions → Policies |
| New workflow needs approval (rare) | Actions tab yellow banner “Approve workflow” |

**Verify:**

```bash
# Active workflows (expect ProxyHubb CI, Security Scan, Deploy, CI diagnostic)
gh api repos/samuel-1-avson/ProxySocialHub/actions/workflows \
  --jq '.workflows[] | {id,name,path,state}'

# Manual run (fails at startup until billing/policy is fixed)
gh workflow run proxyhubb-ci.yml --repo samuel-1-avson/ProxySocialHub --ref main
gh run list --repo samuel-1-avson/ProxySocialHub --workflow proxyhubb-ci.yml --limit 3
```

When healthy, a run shows **jobs** (`changes`, `db-migrate`, `backend-test`, …) within a few seconds — not instant `startup_failure`.

### Repo settings checklist

1. **Settings → Actions → General** — Allow all actions (or allow listed); workflow read/approve as needed.
2. **Settings → Actions → General → Workflow permissions** — Read and write or read-only (either is fine for CI).
3. **Settings → Billing** — Confirm Actions minutes remaining for private repositories.
4. [GitHub Status](https://www.githubstatus.com/) — platform outage.
5. Optional: disable Actions, save, re-enable (clears stuck queues on some repos).

### Temporary diagnostic workflow

[`.github/workflows/ci-diagnostic.yml`](../.github/workflows/ci-diagnostic.yml) — minimal `workflow_dispatch` + `echo`. Use it to confirm Actions can start jobs; delete the file once **ProxyHubb CI** is green.

---

## Related workflows

| File | Triggers | Wallet-related |
|------|----------|----------------|
| `proxyhubb-ci.yml` | push, PR, manual | **Yes** (steps above) |
| `security.yml` | push, PR, weekly cron | Go vuln scan only |
| `deploy.yml` | tags `v*`, manual | No |
