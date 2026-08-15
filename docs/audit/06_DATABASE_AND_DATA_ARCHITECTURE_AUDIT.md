# 06 — Database & Data Architecture Audit

**Stores in use:** PostgreSQL 16 (system of record), Redis 7 (sessions/metering WAL/cache/streams), NATS JetStream (events), Solana (settlement). **Absent:** ClickHouse, TimescaleDB, Kafka, object storage — despite high-volume telemetry needs.

## 1. Migration System

- **Runner:** custom (`internal/db/migrate.go`) — applies `*.up.sql` lexically into `schema_migrations`; triggered by `AUTO_MIGRATE=true` / `MIGRATE_ONLY` (compose `db-migrate` init container). **Not golang-migrate.** `.down.sql` files are CI-smoke only (`continue-on-error: true`).
- **Root `migrations/`:** ~99 ups / ~77 downs. Gaps: 014-026 missing, 104 missing; suffix series `000003b-f`; outlier `20260319110000_*`; non-runner files `migrate_social_to_supabase.sql`, `20260314_sol_only_migration.sql`.
- **Destructive ups (documented):** `000088` drops fiat columns + deletes non-SOL pending txs; `000034` drops backup table; `000047` deletes pending_transactions; `000101` drops old explorer table; `000109` down drops archive+index.
- **`services/control-api/migrations/` (16 files):** **divergent legacy/manual set — not applied by the runner.** Canonical = repo-root `migrations/`. Risk of double-application if run by hand (DB-06).
- **`infra/postgres/init/00_auth_schema.sql`:** local stub for `auth.users` so `000001` FKs work without Supabase GoTrue.

## 2. Data Ownership Matrix

| Entity | Owning service | Store | Cache | Analytics | Chain ref | Sensitive | Problems |
|--------|----------------|-------|-------|-----------|-----------|-----------|----------|
| profiles/users | control-api | PG | — | — | wallet addr | PII (email) | `isp` late-added; role CHECK |
| wallets | control-api (legacy: relayer) | PG | — | — | treasury | financial | float64 app path; relayer column drift (DB-08) |
| wallet_ledger_entries | control-api | PG | — | — | tx_hash | financial | **mutable at DB layer (DB-03)**; single-entry (DB-01) |
| proxy_listings | control-api | PG | Redis 60s | — | — | — | missing country/isp/latency indexes (DB-05); no ASN |
| orders / escrow_* / disputes | control-api | PG | — | — | escrow PDA | financial | order-create authority header (TEST-01) |
| sessions / session_intents | control-api | PG | Redis `session:*` | — | — | credentials | intent prices DOUBLE PRECISION (DB-02) |
| usage_receipts / settlement_manifests | control-api | PG | Redis pending | — | — | financial | hot metering in OLTP; DOUBLE PRECISION price |
| usage_records | control-api (analytics) | PG | — | queried | — | — | **no FKs; writer never called (DB-04)** |
| provider_earnings | control-api | PG | — | — | — | financial | no FK to profiles/sessions at creation |
| pending_transactions / spending_records | control-api | PG | — | — | chain refs | financial | partial unique indexes OK |
| subscriptions | control-api | PG | — | — | — | — | unbounded plan list |
| social (forum/messages/notifications) | control-api | PG | — | — | — | PII content | — |
| audit_logs_partitioned / reconciliation_history | control-api | PG (partitioned) | — | — | — | ops | recon money DOUBLE PRECISION |
| explorer_* | control-api | PG (tx partitioned 000101) | Redis | — | chain | public | high-volume in OLTP |
| live sessions / metering WAL | edge-gateway + control-api | Redis | — | — | — | session creds | **SPOF (EV-05)** |
| escrow/multisig/stake accounts | on-chain | Solana | — | — | — | financial | payout binding fixed; session program unsafe |

## 3. Ledger Design (critical analysis)

**Model:** mutable `wallets.balance_sol` (NUMERIC(20,9)) + append-only single-entry journal (`wallet_ledger_entries.amount` signed, `balance_after`). Helpers (`models/wallet_tx.go:12-65`) do lock+update+insert in one tx — good. **But:**

- **DB-01 (High):** not double-entry. No contra-accounts; no `SUM(debits)=SUM(credits)` invariant; balance-vs-journal drift only caught by hourly reconciliation (`treasury/reconciliation.go:425-438`).
- **DB-02 (High):** Go uses `float64` (`models/wallet.go:27-52`); lamports round-trip helpers (`wallet_money.go`) mitigate; several money columns are DOUBLE PRECISION (`000073` intents, `000077` receipts, `000079` circle, `000049` recon).
- **DB-03 (High):** no `BEFORE UPDATE/DELETE` trigger or REVOKE on the ledger; archive path (`000109`, `scripts/wallet-ledger-archive.sh`) deletes hot rows by design.
- Some paths bypass locked helpers: `staking.go:168-191`, `escrow_listener.go`.

## 4. Query & Index Review

| Hot path | Pattern | Assessment |
|----------|---------|------------|
| Marketplace browse | filters on `LOWER(country)`, `isp ILIKE '%…%'`, sort by `avg_latency_ms` | **missing indexes** → seq scan at scale (DB-05). Existing: `idx_listings_price_uptime`, FTS GIN, provider_node |
| Wallet ops | `SELECT … FOR UPDATE` + append | good |
| Usage ingest | batch upsert into `usage_receipts` + Redis incr | good batching; Redis dependency |
| Analytics | aggregates over `usage_records` | likely stale/empty (DB-04) |
| Secondary lists | unbounded `Find` (plans, badges, circle members, some admin payouts) | pagination gaps |

No N+1 in catalog enrich (batched by listing IDs); watch Preload loops in feed/orders.

## 5. Telemetry Pipeline (as-built)

```
edge-gateway → Redis HINCRBY metering:wal:* → 30s flush → POST /v1/gateway/usage/report
→ usage_receipts (PG, UNIQUE session+nonce) → Redis pending → NATS settlement.receipts → settlement worker
→ Redis Stream events:bandwidth.consumed (log-only consumer)
```

- Not per-request OLTP inserts (batched) — reasonable for MVP.
- **EV-06:** no analytical store. `usage_receipts` + `explorer_transactions` partitions will grow unbounded in OLTP. Recommend ClickHouse/Timescale + rollups (see `18`).

## 6. Redis Usage & SPOF Analysis

Used for: live session records (gateway auth source), usage counters, metering WAL, rate limits, marketplace/feed cache, event streams, config fanout, node discovery. Cluster client exists (`internal/redis/cluster.go`) but compose runs single-node. **Redis loss = live auth + metering loss (EV-05, High).**

## 7. Backup / Retention / PII

- Backup tooling real: `scripts/gcp-postgres-backup.sh` (pg_dump -Fc + sha256 + optional GCS), cron installer, verify + restore drill scripts. Scheduling is install-dependent on the VM.
- Retention: ledger archive migration + script; explorer tx partitioning; no documented PII retention/erasure beyond `/v1/gdpr/delete-account`.
- Encryption at rest: not evidenced (volume-level, platform-dependent); credentials encrypted via `models.CredentialEncryptFn` (app-level) — good.

## 8. Findings

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| DB-01 | Not a double-entry ledger | High | Open |
| DB-02 | float64 money in app; DOUBLE PRECISION money columns | High | Partial (Sprint I: int64 write helpers; float API remains) |
| DB-03 | Ledger mutable at DB layer (no immutability trigger/REVOKE) | High | Open |
| DB-04 | `usage_records`: no FKs; writer unused on hot path | Medium | Open |
| DB-05 | Marketplace filter indexes incomplete (country/isp/latency) | Medium | Open |
| DB-06 | Dual migration dirs; control-api SQL not applied | Medium | Open |
| DB-07 | Migration gaps (014-026, 104); incomplete downs | Low-Med | Open |
| DB-08 | Relayer direct wallet writes w/ stale column names | High | Open (retire relayer) |
| EV-05 | Redis SPOF for sessions/metering | High | Open |
| EV-06 | No ClickHouse/Timescale for telemetry | Medium | Open |
