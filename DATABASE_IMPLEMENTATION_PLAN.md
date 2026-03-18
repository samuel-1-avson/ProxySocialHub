# ProxyHub Database — Implementation Plan

**Based on:** DATABASE_DEEP_DIVE_ANALYSIS_REPORT.md
**Date:** 2026-03-16
**Engineer:** Database Engineering Team

---

## Implementation Order

Items are sequenced to resolve dependencies correctly. All items in the same phase can be applied in parallel.

| Step | ID | Title | Phase | Risk |
|------|----|-------|-------|------|
| 1 | I7 | Remove duplicate AuditLog in AutoMigrate | 1 — Foundation | Low |
| 2 | I5 | Fatal AutoMigrate failure handling | 1 — Foundation | Low |
| 3 | I1 | Gate AutoMigrate behind AUTO_MIGRATE env var | 1 — Foundation | Medium |
| 4 | E8 | GORM logger + slow-query observability | 1 — Foundation | Low |
| 5 | I6 | Redis TTL on usage counters + DeleteUsage | 2 — Redis | Low |
| 6 | I2 | Wallet CHECK constraints (migration 000032) | 3 — DB Constraints | Medium |
| 7 | E10 | Provider token FK constraints (migration 000033) | 3 — DB Constraints | Medium |
| 8 | I4 | Fill migration gap 14–26 (migration 000034) | 4 — Schema Gap | High |
| 9 | I3 | Session credential encryption (GORM hooks) | 5 — Security | High |
| 10 | E2 | Materialised view for provider leaderboard (migration 000035) | 6 — Enhancements | Low |
| 11 | E4 | Full-text search for proxy_listings (migration 000036) | 6 — Enhancements | Low |
| 12 | — | Update .env.example with all new env vars | 7 — Docs | Low |

---

## Detailed Scope per Item

### I7 — Duplicate AuditLog Removal
- **File:** `services/control-api/internal/db/db.go`
- **Change:** Remove second `&models.AuditLog{}` registration in AutoMigrate slice

### I5 — AutoMigrate Fatal Failure
- **File:** `services/control-api/internal/db/db.go`
- **Change:** Return `fmt.Errorf("AutoMigrate failed: %w", err)` instead of log+continue

### I1 — AutoMigrate Env Gate
- **File:** `services/control-api/internal/db/db.go`
- **New env var:** `AUTO_MIGRATE=true` (off by default in production)
- **Change:** Wrap entire AutoMigrate block in `os.Getenv("AUTO_MIGRATE") == "true"` guard

### E8 — GORM Observability
- **File:** `services/control-api/internal/db/db.go`
- **New file:** `services/control-api/internal/db/hooks.go` (Prometheus query duration metrics)
- **New env vars:** `DB_LOG_LEVEL=warn`, `DB_SLOW_QUERY_MS=500`

### I6 — Redis TTL + Cleanup
- **File:** `services/control-api/internal/redis/redis.go`
- **File:** `services/control-api/internal/billing/worker.go`
- **Changes:** Pipeline `Expire` on IncrementUsage, add `DeleteUsage()`, call after settlement

### I3 — Credential Encryption
- **File:** `services/control-api/internal/models/session.go`
- **File:** `services/control-api/main.go`
- **New env var:** `MIGRATE_CREDENTIALS=true` (one-time data migration)
- **Changes:** Add `BeforeSave`/`AfterFind` GORM hooks with function-variable encryption

### I2 — Wallet CHECK Constraints
- **New file:** `migrations/000032_wallet_check_constraints.up.sql`
- **New file:** `migrations/000032_wallet_check_constraints.down.sql`

### E10 — Provider Token FK Constraints
- **New file:** `migrations/000033_provider_token_fk_constraints.up.sql`
- **New file:** `migrations/000033_provider_token_fk_constraints.down.sql`

### I4 — Migration Gap Baseline
- **New file:** `migrations/000034_consolidated_baseline.up.sql`
- **New file:** `migrations/000034_consolidated_baseline.down.sql`

### E2 — Provider Leaderboard Materialised View
- **New file:** `migrations/000035_provider_leaderboard_mv.up.sql`
- **New file:** `migrations/000035_provider_leaderboard_mv.down.sql`
- **File:** `services/control-api/main.go` — background refresh goroutine

### E4 — Listing Full-Text Search
- **New file:** `migrations/000036_listing_fulltext_search.up.sql`
- **New file:** `migrations/000036_listing_fulltext_search.down.sql`
- **File:** `services/control-api/internal/api/listings.go` — `q` query param support

---

## Rollback Strategy

All migration files include a `.down.sql` companion. Apply via:
```bash
# Apply up
psql $DATABASE_URL < migrations/000032_wallet_check_constraints.up.sql

# Rollback
psql $DATABASE_URL < migrations/000032_wallet_check_constraints.down.sql
```

AutoMigrate changes are code-only and reversible by reverting the commit.

---

## Testing Checklist

- [ ] `AUTO_MIGRATE=false` (default): startup completes without any DDL
- [ ] `AUTO_MIGRATE=true`: schema migrates, version record updated
- [ ] `FORCE_MIGRATE=true`: forces schema re-check even if version matches
- [ ] Negative balance rejected by DB CHECK constraint
- [ ] Session credentials decrypt on read after encryption hook registered
- [ ] Redis `session:*:usage` keys expire within 48 hours
- [ ] `mv_provider_leaderboard` refreshes without locking reads
- [ ] Listing full-text search returns results for title/country/isp keywords
- [ ] Slow queries > 500ms appear in logs at WARN level
