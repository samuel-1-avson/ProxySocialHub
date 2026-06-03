# Security audit report (secrets & push gates)

**Date:** 2026-06-03  
**Scope:** Full-repo scan for credential leakage, unsafe tracked files, and pre-push/CI gates.  
**Action taken:** Remediation applied in-repo (untrack secrets, gitignore, gates). **No secret values are reproduced below.**

---

## Executive summary

| Severity | Finding | Status |
|----------|---------|--------|
| **Critical** | `infra/oracle-keypair.json` was **tracked in git** (live Solana 64-byte keypair) | **Removed from index** — rotate key on devnet/mainnet |
| **High** | Local `.env` (gitignored) may hold real `PROVIDER_PRIVATE_KEY`, CoinGecko/CoinMarketCap API keys | **Not in git** — rotate if ever committed or shared |
| **Medium** | `testing/artifacts/*.jsonl` tracked; logs reference oracle pubkey | **Untracked** + `testing/artifacts/` in `.gitignore` |
| **Low** | `services/provider-node/provider.local.rc04.toml` tracked (no secrets in file) | **Untracked**; pattern added to `.gitignore` |
| **Low** | `treasury-keypair.json` on disk only (gitignored) | OK if never pushed |
| **Info** | CI uses explicit test JWT/HMAC strings | Allowed via `.gitleaks.toml` |

**If this repository was ever public with the oracle keypair:** treat that wallet as compromised, generate `solana-keygen new -o infra/oracle-keypair.json`, update program/oracle authority as required, and fund the **new** pubkey.

---

## What was scanned

- `git ls-files` for env, keypair, pem, jwt, local provider configs
- Ripgrep for API keys, JWT blobs, private keys, high-entropy patterns
- Review of `.gitignore`, `.env.example`, Docker env templates, K8s secret refs
- CI workflows: `proxyhubb-ci.yml`, `security.yml`

---

## Findings detail

### 1. Tracked Solana keypairs (fixed)

- **`infra/oracle-keypair.json`** — committed Solana keypair JSON; referenced by `docker-compose.yml`, `docker-compose.dev.yml`, docs, and settlement scripts.
- **Remediation:** `git rm --cached`, `infra/oracle-keypair.json.example` (zeros only), `infra/README.md`, `scripts/ensure-oracle-keypair.{ps1,sh}`, explicit `.gitignore` entry.

### 2. Environment files (OK if ignored)

- **`.env`**, **`.env.local`**, **`config/docker/provider.compose.env`** — listed in `.gitignore`; not in current index.
- **Tracked templates (safe):** `.env.example`, `.env.docker.example`, `config/docker/provider.compose.env.example`, `config/docker/control-api-explorer.env` (flags only).

### 3. Provider local config

- **`provider.local.rc04.toml`** — operator-local TOML; contained only localhost URLs (no `api_key`). Removed from tracking; `**/provider.local*.toml` ignored.

### 4. Test artifacts

- **`testing/artifacts/`** — Go test JSONL outputs; may echo oracle pubkeys from integration runs. Added to `.gitignore` and removed from index.

### 5. Application / ops configuration (review, not secret leakage)

| Item | Risk | Notes |
|------|------|--------|
| `ADMIN_API_ENABLED` | Medium in prod | Default `false` in compose; keep off in production |
| `EXPLORER_PUBLIC_*` | Low | Dev compose enables some public explorer routes |
| `ENABLE_DEBUG_ROUTES` | Medium | Only in edge P3 test compose files |
| `dev_server_signing` / provider dev listing sign | High if enabled in prod | Dev-only API paths — gate via env in prod |
| CI `POSTGRES_PASSWORD=proxyhubb` | Low | Ephemeral CI DB only |
| K8s `postgres-secret` | OK | References Kubernetes secrets, not literal passwords in repo |

### 6. Gates added or strengthened

| Gate | Location |
|------|----------|
| Pre-commit script | `scripts/pre-commit-security.sh`, `scripts/pre-commit-security.ps1` |
| Pre-commit hook config | `.pre-commit-config.yaml` |
| Gitleaks config | `.gitleaks.toml` |
| CI on every PR/push | `proxyhubb-ci.yml` → job `secrets-gate` |
| Weekly / PR deep scan | `.github/workflows/security.yml` (existing) |
| Operator doc | `docs/SECURITY_GATES.md` |

---

## Recommended actions (operators)

1. **Rotate** signing credentials that lived in `.env` if they were ever committed or shared (e.g. `PROVIDER_PRIVATE_KEY`, provider HMAC tokens). Price-feed keys (`COINGECKO_API_KEY`, `COINMARKETCAP_API_KEY`) only need rotation if those specific values were exposed.
2. **Generate a new oracle keypair** locally; do not restore the old file from git history for signing.
3. Install gates locally: `pre-commit install` or run `./scripts/pre-commit-security.sh` before push.
4. Optional: run `gitleaks detect --source . --config .gitleaks.toml` on a clean clone.
5. For **history cleanup** on GitHub (if the repo was public): use `git filter-repo` or BFG to purge `infra/oracle-keypair.json` from all commits, then force-push only after team agreement (rewrites history).

---

## Files changed in this remediation

- Untrack: `infra/oracle-keypair.json`, `services/provider-node/provider.local.rc04.toml`, `testing/artifacts/**`
- Add: `infra/oracle-keypair.json.example`, `infra/README.md`, security scripts, `.gitleaks.toml`, `.pre-commit-config.yaml`, `docs/SECURITY_GATES.md`
- Update: `.gitignore`, `proxyhubb-ci.yml`, `compose-up-dev.ps1`, `fund-oracle.ps1`

---

## Related docs

- [`docs/SECURITY_GATES.md`](../SECURITY_GATES.md) — day-to-day checklist  
- [`infra/README.md`](../../infra/README.md) — oracle keypair setup  
- [`docs/STAGING_ENFORCE_RUNBOOK.md`](../STAGING_ENFORCE_RUNBOOK.md) — staging secrets (no values in repo)
