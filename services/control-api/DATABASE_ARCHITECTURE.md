# Database Architecture

ProxyHubb uses a **split-database** strategy: a local PostgreSQL instance (Docker) handles
all transactional, financial, and operational data, while an optional Supabase PostgreSQL
instance hosts social and community tables that benefit from Supabase's realtime
subscriptions and Auth features.

---

## Connection Topology

```
Browser / Next.js
    │
    ├─► Control API (Go / GORM)
    │       ├─ db.DB       →  Local PostgreSQL  (Docker / self-hosted)
    │       └─ db.Social() →  Supabase PostgreSQL  (optional; falls back to local DB)
    │
    └─► Supabase JS SDK    →  Supabase REST / Realtime  (Auth, social subscriptions)
```

`db.Social()` transparently returns `db.DB` when `SUPABASE_DATABASE_URL` is not set,
so the split is entirely transparent to callers.

---

## Local PostgreSQL (Primary)

**Config env vars:** `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`

All tables are created here unless `SUPABASE_DATABASE_URL` is set **and** the table
appears in the `InitSocial()` migration list (see below). This is the source of truth
for money, sessions, and provider operations.

### Table Inventory

| Group | Tables |
|---|---|
| **Identity / Auth** | `users`, `api_keys`, `refresh_token_families`, `totp_backup_codes` |
| **Security** | `audit_logs`, `security_anomalies`, `web_authn_credentials`, `login_attempts`, `account_lockouts`, `user_settings`, `user_sessions` |
| **Wallet / Finance** | `wallets`, `wallet_ledger_entries`, `staking_positions`, `pending_transactions`, `spending_records`, `pending_payouts`, `payout_retry_queues` |
| **Batch Payouts** | `batch_payouts`, `batch_payout_items` |
| **Provider Earnings** | `provider_earnings`, `provider_scores` |
| **Sessions / Nodes** | `sessions`, `nodes`, `session_metrics`, `session_configurations`, `provider_nodes` |
| **Marketplace** | `proxy_listings`, `saved_listings`, `orders`, `escrow_transactions`, `escrow_disputes`, `disputes`, `dispute_juries` |
| **Provider CLI** | `provider_tokens`, `provider_node_registrations`, `cli_downloads` |
| **Blockchain** | `explorer_blocks`, `explorer_transactions`, `explorer_nodes`, `explorer_contracts`, `explorer_metrics`, `linked_wallets`, `blockchain_state_caches`, `encrypted_credentials` |
| **Proxy Engine** | `service_configurations`, `system_configurations`, `routing_profiles`, `proxy_pools` |
| **Trustless / Quality** | `usage_proofs`, `validators`, `consensus_rounds`, `quality_attestations`, `usage_records` |
| **Incentivization** | `proof_of_services`, `miner_weights` |
| **Smart Matching** | `use_cases`, `user_preferences`, `match_requests` |
| **Agents** | `market_agents`, `agent_instances`, `agent_jobs` |
| **Admin** | `admin_notes` |
| **Onboarding** | `provider_applications` |

---

## Supabase PostgreSQL (Social / Optional)

**Config env vars:** `SUPABASE_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`

When `SUPABASE_DATABASE_URL` is set, the tables below are migrated to Supabase and all
GORM queries routed there via `db.Social()`. When it is not set, these tables live in
local PostgreSQL alongside everything else — no code changes required.

### Why Supabase for social tables?
- **Realtime subscriptions** — feed, notifications, messaging use Supabase Realtime
- **Auth integration** — social features link to Supabase Auth user IDs
- **Row-Level Security** — Supabase policies enforce per-user data isolation at the DB layer
- **Separation of concerns** — social features scale and deploy independently

### Table Inventory

| Group | Tables |
|---|---|
| **Social Graph** | `follows`, `friend_requests`, `friendships`, `badges`, `user_badges`, `feed_events`, `reviews` |
| **Notifications** | `notifications`, `notification_preferences` |
| **Showcase** | `provider_showcases`, `speed_tests`, `testimonials`, `provider_stats` |
| **Forum** | `forum_categories`, `forum_threads`, `forum_posts`, `forum_votes` |
| **Messaging** | `conversations`, `messages`, `message_reactions` |
| **Circles** | `circles`, `circle_members`, `circle_invites`, `circle_slas`, `circle_daily_stats`, `circle_posts`, `circle_leases` |
| **Subscriptions** | `subscription_plans`, `user_subscriptions` |
| **Governance** | `proposals`, `votes` |
| **Smart Matching** | `use_cases`, `user_preferences`, `match_requests` |
| **Agents** | `agents`, `agent_outputs`, `market_agents`, `agent_instances`, `agent_jobs` |

> **Note:** `use_cases`, `user_preferences`, `match_requests`, `market_agents`,
> `agent_instances`, and `agent_jobs` appear in **both** local and Supabase migration
> lists. GORM's `AutoMigrate` is idempotent (CREATE IF NOT EXISTS), so the duplicate
> is safe. If you enable the Supabase split, queries to these tables will go to Supabase.

---

## Connection Configuration

### Local PostgreSQL
- **Pool:** max 10 open (configurable via `DB_MAX_OPEN_CONNS`), max 2 idle (`DB_MAX_IDLE_CONNS`)
- **Lifetime:** 1 hour max, 10 min max idle
- **Logging:** controlled by `DB_LOG_LEVEL` (silent/error/warn/info) and `DB_SLOW_QUERY_MS`

### Supabase PostgreSQL
- **Port:** Must use **5432** (Session Pooler) — NOT 6543 (Transaction Pooler).
  GORM manages its own connection pool; Transaction Pooler resets `search_path` on
  every transaction, breaking `AutoMigrate` with `SQLSTATE 3F000`.
  `InitSocial()` automatically rewrites `:6543/` → `:5432/` in the DSN.
- **Protocol:** `PreferSimpleProtocol: true` — avoids prepared-statement conflicts with pgBouncer.
- **PrepareStmt:** `false` — same reason.
- **Pool:** max 5 open, max 2 idle (Supabase free tier limits concurrent connections).
- **Slow query threshold:** 2 s (remote latency of 200–400 ms makes the default 200 ms fire constantly).

---

## Migration Strategy

| Env Var | Purpose |
|---|---|
| `AUTO_MIGRATE=true` | Run GORM `AutoMigrate` on startup — set **only** in migration init-containers/jobs |
| `FORCE_MIGRATE=true` | Bypass schema version cache; re-run all migrations |
| `MIGRATE_CREDENTIALS=true` | One-time migration: encrypt plaintext session credentials (I3) |

**Production pattern:**
1. Deploy a short-lived migration job/init-container with `AUTO_MIGRATE=true`.
2. Normal API pods start with `AUTO_MIGRATE` unset — fast startup, no DDL locks.
3. SQL migrations in `/migrations/` apply structural changes that GORM AutoMigrate cannot
   (e.g., adding constraints, creating materialised views, enabling extensions).

---

## Read Replica (Optional)

**Config env var:** `READ_REPLICA_URL`

When set, analytics and search queries are routed to a PostgreSQL read replica,
reducing load on the primary. Falls back to the primary if unset.
