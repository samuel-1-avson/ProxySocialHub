# ProxyHub — Security & Architecture Fixes Implementation Plan

**Created:** 2026-03-16
**Based on:** FULL_SYSTEM_ANALYSIS_REPORT.md — Sections 16 & 17
**Scope:** All critical issues, security weaknesses, architectural cons, and operational gaps

---

## Overview

This plan addresses every issue identified in the system analysis report, organized by severity tier.
Each item lists the exact file(s) affected, the root cause, and the implemented fix.

---

## Priority 1 — CRITICAL (Fix Immediately)

### C1. Broken Auth Rate Limiter
- **File:** `services/control-api/internal/api/auth.go`
- **Root Cause:** `authRateLimit()` iterates over the stored string as characters and sums ASCII
  digit values (`int(v - '0')`), not the actual request count. The result is unpredictable — the
  limit can be hit too early or never at all depending on the stored string value.
- **Fix:** Replace the broken in-memory implementation with the existing Redis-backed
  `StrictRateLimit()` (already implemented in `ratelimit.go`). This also makes rate limiting
  distributed-safe for multi-instance deployments.

### C2. New User Default Role = "provider"
- **File:** `services/control-api/internal/api/auth.go` (walletLogin)
- **Root Cause:** New user creation hardcodes `Role: "provider"`, giving every new wallet
  login elevated marketplace permissions (create listings, provider dashboard) that should
  only be granted after explicit provider onboarding.
- **Fix:** Default new users to `Role: "user"`.

### C3. devLogin Creates Privileged Account With 1000 SOL
- **File:** `services/control-api/internal/api/auth.go` (devLogin)
- **Root Cause:** Dev test user is created as `provider` with `BalanceSOL: 1000.0`.
  If `APP_ENV=development` and `DEV_LOGIN_SECRET` is weak or leaked, attackers get
  a high-value funded provider account.
- **Fix:** Role → `"user"`, BalanceSOL → `0.0`. Tests should fund via the normal faucet flow.

### C4. Redis Running With No Authentication
- **File:** `docker-compose.yml`
- **Root Cause:** `redis-server --protected-mode no` disables all Redis access controls.
  Any container on the Docker bridge network can read and write session tokens, nonces,
  rate limit counters, and billing state.
- **Fix:** Enable `requirepass ${REDIS_PASSWORD}`. Update all `REDIS_URL` references to
  include the password. Add `REDIS_PASSWORD` to `.env.example`.

### C5. Grafana Admin Password Hardcoded as "admin"
- **File:** `docker-compose.yml`
- **Root Cause:** `GF_SECURITY_ADMIN_PASSWORD=admin` is the most well-known default credential.
  Any developer who runs `docker-compose up` gets full Grafana dashboard access without
  any configuration.
- **Fix:** Use `${GRAFANA_ADMIN_PASSWORD}` with no insecure default value.

---

## Priority 2 — HIGH

### H1. CORS Dev-Fallback Uses Wrong Environment Variable
- **File:** `services/control-api/main.go`
- **Root Cause:** The CORS wildcard fallback checks `GO_ENV == "development"` but
  `docker-compose.yml` sets `APP_ENV=development`. The two variables are inconsistent.
  Anyone who sets `GO_ENV=development` locally gets silent CORS open-door for all origins.
- **Fix:** Align to `APP_ENV`. Tighten the localhost-only fallback to only reflect origins
  matching `http://localhost:*` or `http://127.0.0.1:*`, not arbitrary origins.

### H2. Weak Self-Transfer Guard Comment Creates False Confidence
- **File:** `services/control-api/internal/api/wallet.go`
- **Root Cause:** The first check `req.RecipientIdentifier == senderID` compares a
  UUID string against an email/username — it can never match. The comment says
  "Weak check" but the code is effectively a no-op guard that misleads readers.
  The real guard (line 327, UUID comparison after DB lookup) works correctly.
- **Fix:** Remove the misleading no-op first check. Keep only the post-lookup UUID guard.
  Also add a `wallet_address` self-transfer check for users trying to send to their own
  linked Solana address.

### H3. No API Versioning
- **File:** `services/control-api/main.go`
- **Root Cause:** All routes are under `/api/` with no version prefix. Any breaking
  change in a handler signature forces simultaneous client updates across web, admin, and CLI.
- **Fix:** Add `/v1/` prefix group wrapping all existing route registrations.

### H4. Database Connection Pool Not Environment-Aware
- **File:** `services/control-api/internal/db/db.go`
- **Root Cause:** `SetMaxOpenConns(10)` is hardcoded for Supabase Transaction Pool
  (pgBouncer) mode. For direct PostgreSQL (self-hosted / development), 10 connections
  causes pool starvation under the load of multiple background workers + concurrent API calls.
- **Fix:** Read `DB_MAX_OPEN_CONNS` and `DB_MAX_IDLE_CONNS` from environment. Sensible
  defaults: 10 for Supabase/PgBouncer, 25 for direct PostgreSQL.

### H5. No Rate Limiting on Wallet Financial Endpoints
- **File:** `services/control-api/internal/api/wallet.go`
- **Root Cause:** `POST /wallet/transfer` and `POST /wallet/withdraw/sol` have no rate
  limiting. An attacker with a valid JWT can loop these to probe the spending limit system
  or cause excessive Solana RPC calls.
- **Fix:** Apply `StrictRateLimit()` (5 req/min) to all financial mutation endpoints.

---

## Priority 3 — MEDIUM

### M1. .env.example Missing Critical Variables
- **File:** `.env.example`
- **Missing vars:** `ADMIN_JWT_SECRET`, `DEV_LOGIN_SECRET`, `GRAFANA_ADMIN_PASSWORD`,
  `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD`,
  `GEO_DENY_LIST`, `GEO_ALLOW_LIST`, `ADMIN_ACCOUNT_*` x9, `GO_ENV`,
  `FORCE_MIGRATE`, `SOLANA_WS_ENDPOINT`, `GIN_MODE`.
- **Fix:** Add all missing variables with inline documentation.

### M2. Inconsistent Error Response Format
- **Files:** `services/control-api/internal/api/*.go`
- **Root Cause:** At least 3 different error shapes are returned across handlers:
  `{"error":"..."}`, `{"message":"..."}`, `ErrorResponse{Error:"..."}`.
  The frontend must handle all variants and new handlers risk adding more.
- **Fix:** Define one `ErrorResponse` struct. Add a `RespondError()` helper used in all handlers.

### M3. Phantom Ledger Entry on Failed SOL Withdrawal
- **File:** `services/control-api/internal/api/wallet.go`
- **Root Cause:** The ledger debit entry is written inside the DB transaction before
  the on-chain Solana transfer. If the chain transfer fails, the balance is refunded
  but the debit ledger entry is not reversed — creating a phantom entry in transaction history.
- **Fix:** Write the ledger entry only after on-chain success. On failure, create a
  "withdrawal_reversed" ledger entry for auditability.

### M4. DB Transactions Have No Timeout Context
- **Files:** `wallet.go`, `escrow.go`
- **Root Cause:** `db.DB.Begin()` / `db.DB.Transaction()` calls use the request context
  without a timeout. A slow or hung DB query holds locks indefinitely, blocking other requests.
- **Fix:** Wrap all transaction operations with a 30-second context timeout.

### M5. Oracle Private Key on Host Filesystem (Production Risk)
- **File:** `docker-compose.yml`, `docker-compose.prod.yml`
- **Root Cause:** `./oracle-keypair.json` is a bind-mount from the host filesystem.
  Host compromise = total treasury drain.
- **Fix (documentation):** Add startup warning when `GIN_MODE=release` and keypair is file-based.
  Document use of Docker Secrets, AWS Secrets Manager, or HashiCorp Vault.

### M6. Orphaned Multi-Currency Migration Columns
- **File:** `migrations/`
- **Root Cause:** Migration `000003_wallet_multi_currency` creates columns that were
  superseded by the SOL-only migration, adding DB bloat and confusion on fresh installs.
- **Fix:** Add `migrations/000030_remove_multicurrency_columns.up.sql`.

---

## Priority 4 — LOW / OPERATIONAL

### L1. No Automated Database Backup
- **Fix:** Add `pg-backup` service to docker-compose or document pg_dump cron with rotation.

### L2. No Horizontal Scaling Documentation
- **Fix:** Document Redis distributed lock (`SET NX`) pattern for singleton workers.
  Add `INSTANCE_ID` env var. Add leader-election before settlement/indexer worker loops.

### L3. CLI Distribution Has No Version Manifest
- **Fix:** Add `cli-dist/manifest.json`. Serve via `GET /api/v1/cli/manifest`.

### L4. Large main.go (600+ lines)
- **Fix:** Extract `internal/startup/` package with discrete init functions.

---

## Execution Status

| ID | Issue | File | Status |
|---|---|---|---|
| C1 | Broken authRateLimit() | auth.go | ✅ |
| C2 | New user role = provider | auth.go | ✅ |
| C3 | devLogin 1000 SOL + provider | auth.go | ✅ |
| C4 | Redis no auth | docker-compose.yml | ✅ |
| C5 | Grafana hardcoded admin | docker-compose.yml | ✅ |
| H1 | CORS GO_ENV vs APP_ENV | main.go | ✅ |
| H2 | Weak self-transfer check | wallet.go | ✅ |
| H3 | No API versioning | main.go | ✅ |
| H4 | DB pool hardcoded | db.go | ✅ |
| H5 | No rate limit on wallet ops | wallet.go | ✅ |
| M1 | .env.example incomplete | .env.example | ✅ |
| M2 | Inconsistent error format | api/*.go | ✅ |
| M3 | Phantom ledger entry | wallet.go | ✅ |
| M4 | No tx timeouts | wallet.go | ✅ |

---

*Plan: 2026-03-16 | Fixes applied in the same session.*
