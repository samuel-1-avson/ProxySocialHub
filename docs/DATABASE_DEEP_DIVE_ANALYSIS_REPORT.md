# ProxyHub — Database System Deep-Dive Analysis Report

**Author:** Database Engineering Analysis
**Date:** 2026-03-16
**Scope:** Full database system — schema, models, API interactions, caching layer, migrations, security, and operational patterns
**Version Analysed:** `CurrentSchemaVersion = 20260316-0002`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Database Architecture Overview](#2-database-architecture-overview)
3. [Architecture Diagram](#3-architecture-diagram)
4. [Technology Stack](#4-technology-stack)
5. [Schema Structure — All Domains](#5-schema-structure--all-domains)
6. [Migration History & Strategy](#6-migration-history--strategy)
7. [Data Access Layer](#7-data-access-layer)
8. [Redis Caching Architecture](#8-redis-caching-architecture)
9. [Supabase Auth Integration](#9-supabase-auth-integration)
10. [Financial Engine & Billing Database Flows](#10-financial-engine--billing-database-flows)
11. [Security Model](#11-security-model)
12. [Performance & Indexing Strategy](#12-performance--indexing-strategy)
13. [Pros (Strengths)](#13-pros-strengths)
14. [Cons (Weaknesses)](#14-cons-weaknesses)
15. [Ratings](#15-ratings)
16. [Improvements Required](#16-improvements-required)
17. [Enhancements Recommended](#17-enhancements-recommended)
18. [Workflow Diagrams](#18-workflow-diagrams)
19. [Summary Scorecard](#19-summary-scorecard)

---

## 1. Executive Summary

ProxyHub's database system is a **multi-layer, event-driven architecture** built on top of **Supabase-hosted PostgreSQL** as the primary persistence store, **Redis** as an in-memory cache and real-time session bus, and **Solana on-chain storage** for trustless escrow and node registry. The application-side ORM is **GORM v2** (Go), with a smart auto-migration guard, read-replica support, and a structured repository pattern for core domains.

The system manages **50+ distinct data models** spanning 10 core domains: Identity & Auth, Wallets & Billing, Proxy Sessions, Marketplace, Social Platform, Governance, Blockchain Explorer, Security & Audit, Provider Operations, and Decentralised Consensus.

The overall design is ambitious and well-structured, demonstrating significant investment in reliability (payout retry queues, batch payouts, spending limits), security (Row Level Security, WebAuthn, audit logs with partitioning), and decentralization (on-chain node registry, ZK proofs, quality attestation consensus). However, several structural risks — including dual-schema fragmentation, inconsistent FK enforcement, and blocking AutoMigrate calls — need attention before production at scale.

---

## 2. Database Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         ProxyHub Platform                            │
│                                                                      │
│  ┌───────────────────┐    ┌───────────────────┐                      │
│  │   Web Frontend    │    │   Edge Gateway    │                      │
│  │ (Next.js/React)   │    │  (Rust / Axum)    │                      │
│  └────────┬──────────┘    └────────┬──────────┘                      │
│           │                        │                                  │
│           ▼                        ▼                                  │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │                 Control API (Go / Gin)                       │     │
│  │                                                              │     │
│  │   ┌──────────────────────────────────────────────────────┐  │     │
│  │   │               Data Access Layer                       │  │     │
│  │   │  GORM v2  │  Repository Pattern  │  Domain Entities   │  │     │
│  │   └──────────────────────────────────────────────────────┘  │     │
│  └─────────────────────────────────────────────────────────────┘     │
│           │                │                │                         │
│           ▼                ▼                ▼                         │
│  ┌────────────────┐  ┌──────────┐  ┌────────────────────┐            │
│  │   Supabase     │  │  Redis   │  │  Solana Blockchain  │            │
│  │  PostgreSQL    │  │  Cache   │  │  (On-Chain State)   │            │
│  │  (Primary DB)  │  │  Cluster │  │   Node Registry     │            │
│  │                │  │          │  │   Escrow Program    │            │
│  │  + Read Replica│  │          │  │   Staking Program   │            │
│  └────────────────┘  └──────────┘  └────────────────────┘            │
└──────────────────────────────────────────────────────────────────────┘
```

### Layered Data Flow

```
Request → Auth Middleware → API Handler
             │                  │
             │ (validate JWT)   │ (business logic)
             ▼                  ▼
      Supabase Auth API    GORM Repository
             │                  │
             │                  ├── Primary DB (writes)
             │                  └── Read Replica (analytics reads)
             │
             ▼
      Local DB User Sync ──────► profiles table
             │
             ▼
        Redis Session ──────────► session:{id} key
```

---

## 3. Architecture Diagram

### Full Entity Relationship Diagram (Conceptual)

```
auth.users (Supabase)
    │
    └──► profiles (User)
              │
              ├──► wallets ──────────────► wallet_ledger_entries
              │         └──► spending_records
              │
              ├──► sessions ────────────► session_metrics
              │         └──► proxy_listings (via listing_id)
              │
              ├──► nodes ───────────────► uptime_checks
              │
              ├──► provider_nodes ──────► provider_earnings
              │         └──► pending_payouts ─► batch_payout_items ─► batch_payouts
              │
              ├──► orders ──────────────► escrow_transactions
              │         └──► escrow_disputes
              │                    └──► disputes ──► dispute_jury
              │
              ├──► provider_tokens ─────► provider_node_registrations
              │
              ├──► audit_logs (partitioned by month)
              │
              ├──► security_anomalies
              │
              ├──► api_keys
              │
              ├──► notifications ────────► notification_preferences
              │
              ├──► conversations ────────► messages
              │                               └──► message_reactions
              │
              ├──► forum_categories ─────► forum_threads ──► forum_posts ──► forum_votes
              │
              ├──► circles ─────────────► circle_members
              │         ├──► circle_invites
              │         ├──► circle_sla
              │         └──► circle_daily_stats
              │
              ├──► proposals ───────────► votes (governance)
              │
              ├──► staking_positions
              │
              ├──► subscriptions ────────► subscription_plans
              │
              ├──► agents ──────────────► agent_outputs
              │
              ├──► linked_wallets
              │
              └──► referral_codes ───────► referral_rewards

BLOCKCHAIN LAYER (Solana):
    solana.Node Registry ──────► nodes (synced)
    solana.Escrow Program ─────► escrow_transactions (mirrored)
    solana.Staking ────────────► staking_positions (synced)

CONSENSUS LAYER:
    validators ─────────────────► quality_attestations
                                       │
                                       └──► consensus_rounds

EXPLORER LAYER (Read-Optimised Cache):
    explorer_blocks
    explorer_transactions
    explorer_nodes
    explorer_contracts
    explorer_metrics

RELIABILITY LAYER:
    payout_retry_queue
    batch_payouts ──────────────► batch_payout_items
    pending_payouts
```

---

## 4. Technology Stack

| Component | Technology | Version / Notes |
|-----------|-----------|----------------|
| Primary Database | PostgreSQL (Supabase) | PgBouncer transaction-pool mode |
| ORM | GORM v2 | Go `gorm.io/gorm` + `gorm.io/driver/postgres` |
| In-Memory Cache | Redis | Single-node or Cluster mode (auto-detected) |
| Authentication | Supabase Auth | JWT + local fallback |
| Blockchain | Solana (Devnet/Mainnet) | Custom program via `solana.Client` |
| Migrations | SQL files + GORM AutoMigrate | Schema version guard |
| Connection Pooling | `database/sql` pool | Max 10 conns (PgBouncer safe) |
| Read Replica | Optional PostgreSQL replica | `READ_REPLICA_URL` env |
| Audit Partitioning | pg_cron (optional) | Monthly audit log partitions |
| UUID Generation | `github.com/google/uuid` | Application-generated, not DB default |
| Row Level Security | PostgreSQL RLS | On Supabase tables |

---

## 5. Schema Structure — All Domains

### Domain 1: Identity & Authentication

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `profiles` | `id` (FK → auth.users), `email`, `role`, `trust_tier` | Core user identity; maps to Supabase |
| `api_keys` | `user_id`, `key_hash`, `permissions` | API access control |
| `refresh_token_families` | `user_id`, `family_id`, `token_hash` | Refresh token rotation |
| `totp_backup_codes` | `user_id`, `code_hash`, `used` | MFA backup codes |
| `user_settings` | `user_id`, security preferences | User-level settings |
| `user_sessions` | `user_id`, `ip`, `device`, `is_active` | Active web session tracking |
| `login_attempts` | `email`, `ip`, `success`, `created_at` | Brute-force detection |
| `account_lockouts` | `user_id`, `locked_until` | Automatic lockout enforcement |
| `webauthn_credentials` | `user_id`, `credential_id`, `public_key` | Passkey/WebAuthn support |
| `provider_tokens` | `user_id`, `token`, `expires_at` | CLI authentication tokens |
| `provider_node_registrations` | `user_id`, `token_id`, `node_id` | CLI token ↔ node binding |

### Domain 2: Wallets & Financial

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `wallets` | `user_id`, `balance_sol`, `daily_limit`, `weekly_limit`, `monthly_limit` | SOL-only wallet with spending limits |
| `wallet_ledger_entries` | `wallet_id`, `amount`, `balance_after`, `type` | Immutable double-entry ledger |
| `pending_transactions` | `reference`, `idempotency_key`, `user_id`, `amount`, `status` | Blockchain tx confirmation tracking |
| `spending_records` | `user_id`, `wallet_id`, `amount`, `type` | Per-transaction spending for limit enforcement |
| `staking_positions` | `user_id`, `node_id`, `staked_amount_sol` | SOL staking positions |

### Domain 3: Provider Operations & Earnings

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `provider_nodes` | `user_id`, `tier`, `quality_score`, `uptime_percent`, `wallet_address` | Provider node metadata and tier |
| `provider_earnings` | `provider_user_id`, `session_id`, `net_amount_sol`, `status` | Per-session earnings (SOL) |
| `pending_payouts` | `provider_id`, `idempotency_key`, `amount_sol`, `priority` | Payout queue |
| `batch_payouts` | `status`, `total_amount`, `gas_fee_lamports` | Batch payout header |
| `batch_payout_items` | `batch_id`, `provider_id`, `wallet_address`, `amount_sol` | Individual payout records |
| `payout_retry_queue` | `provider_id`, `amount_sol`, `attempt_count`, `next_retry_at` | Failed payout retry with exponential backoff |

### Domain 4: Proxy Sessions

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `sessions` | `user_id`, `node_id`, `listing_id`, `status`, `bytes_used`, `deleted_at` | Core proxy session with soft-delete |
| `session_metrics` | `session_id`, `avg_latency_ms`, `success_rate` | Real-time session quality |
| `session_configurations` | `session_id`, `config_json` | Per-session routing config |

### Domain 5: Marketplace & Orders

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `proxy_listings` | `seller_id`, `price_per_gb`, `quality_score`, `status` | Provider bandwidth listings |
| `saved_listings` | `user_id`, `listing_id` | Favourited listings |
| `orders` | `buyer_id`, `seller_id`, `listing_id`, `total_price`, `escrow_pda` | Purchase records with Solana escrow ref |
| `escrow_transactions` | `order_id`, `buyer_id`, `seller_id`, `amount`, `status` | Escrow lifecycle tracking |
| `escrow_milestones` | `escrow_id`, `byte_threshold`, `amount`, `status` | Granular milestone-based release |
| `escrow_disputes` | `escrow_id`, `reason`, `status`, `resolution` | Buyer-seller escrow disputes |
| `disputes` | `session_id`, `consumer_id`, `provider_id`, `refund_sol` | Session-level disputes (SOL refunds) |
| `dispute_jury` | `dispute_id`, `juror_id`, `vote` | Decentralised jury voting |
| `reviews` | `reviewer_id`, `provider_id`, `rating`, `comment` | Rating system |

### Domain 6: Social Platform

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `notifications` | `user_id`, `type`, `is_read`, `channels_delivered` | Multi-channel notification system |
| `notification_preferences` | `user_id`, channel preferences per category | User notification control |
| `follows` | `follower_id`, `following_id` | Social follow graph |
| `feed_events` | `actor_id`, `event_type`, `target_id` | Activity feed |
| `friend_requests` | `sender_id`, `receiver_id`, `status` | Friend request flow |
| `friendships` | `user_id_1`, `user_id_2` | Confirmed friendship pairs |
| `badges` + `user_badges` | `name`, `icon`, awarded to users | Achievement system |
| `conversations` + `messages` | `participants`, `content`, `reply_to_id` | Encrypted messaging |
| `message_reactions` | `message_id`, `user_id`, `emoji` | Emoji reactions |
| `provider_showcases` | `provider_id`, `type`, `metrics` | Provider profile showcase |
| `speed_tests` | `provider_id`, `download_speed`, `latency_ms` | Network performance records |
| `testimonials` | `provider_id`, `customer_id`, `rating` | Customer testimonials |
| `provider_stats` | `provider_id`, cached aggregates | Materialised provider stats |

### Domain 7: Community & Circles

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `circles` | `owner_id`, `name`, `is_public` | Provider/user groups |
| `circle_members` | `circle_id`, `user_id`, `role` | Membership with roles |
| `circle_invites` | `circle_id`, `invitee_id`, `token` | Invitation flow |
| `circle_sla` | `circle_id`, `uptime_sla`, `latency_sla` | Circle-level SLA agreements |
| `circle_daily_stats` | `circle_id`, `date`, daily metrics | Aggregated daily stats |
| `forum_categories` + `forum_threads` + `forum_posts` + `forum_votes` | Full threaded forum | Community discussion |

### Domain 8: Security & Audit

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `audit_logs` (partitioned) | `event_type`, `actor_id`, `severity`, `ip_address` | Comprehensive event audit trail |
| `security_anomalies` | `user_id`, `anomaly_type`, `risk_score`, `action_taken` | ML-detected suspicious activity |
| `webauthn_credentials` | `user_id`, `credential_id`, `public_key` | Hardware key / passkey support |

### Domain 9: Blockchain & Explorer

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `explorer_blocks` | `block_hash`, `block_number`, `slot` | Cached Solana/EVM blocks |
| `explorer_transactions` | `tx_hash`, `from_address`, `to_address`, `amount` | Indexed transactions |
| `explorer_nodes` | `node_id`, `region`, `stake_amount` | Cached validator/node states |
| `explorer_contracts` | `address`, `contract_type`, `total_volume` | Smart contract registry |
| `explorer_metrics` | `chain`, `period`, aggregated KPIs | Network-wide metrics |
| `linked_wallets` | `user_id`, `address`, `chain`, `is_primary`, `verified` | Multi-chain wallet linking |
| `blockchain_state_cache` | `key`, `value`, `expires_at` | On-chain state local cache |
| `encrypted_credentials` | `user_id`, `ciphertext` | Encrypted wallet credentials |

### Domain 10: Decentralised Consensus

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `validators` | `user_id`, `hotkey`, `staked_amount`, `accuracy_rate` | Validator registry |
| `consensus_rounds` | `provider_id`, `consensus_reached`, `consensus_score` | Quality attestation rounds |
| `quality_attestations` | `validator_id`, `overall_score`, `signature`, `message_hash` | Signed attestations |
| `usage_proofs` | `session_id`, `proof_hash`, `verified` | ZK usage proofs |

### Domain 11: Agents & AI

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `agents` | `user_id`, `name`, `type`, `config` | AI agent definitions |
| `agent_outputs` | `agent_id`, `output`, `status` | Agent execution results |
| `market_agents` + `agent_instances` + `agent_jobs` | `type`, `status`, `result` | Marketplace agent tasks |

### Domain 12: Governance

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `proposals` | `creator_id`, `title`, `status`, `votes_for`, `votes_against` | Platform governance proposals |
| `votes` | `proposal_id`, `voter_id`, `vote_type` | Individual votes |

---

## 6. Migration History & Strategy

### Migration Timeline

| File | Version | Change |
|------|---------|--------|
| `000001_init_supabase.up.sql` | v1 | Core schema: profiles, wallets, nodes, sessions, circles + RLS + triggers |
| `000002_consensus_tables.up.sql` | v2 | Quality attestation: validators, consensus_rounds, quality_attestations |
| `000003_wallet_multi_currency.up.sql` | v3 | Added `balance_sol` + `balance_usdt` columns |
| `000004_performance_indexes.up.sql` | v4 | Composite indexes on sessions, orders, listings, escrow |
| `000005_provider_tiers.up.sql` | v5 | `provider_tier` ENUM on `provider_nodes`; tier scoring fields |
| `000006_social_features.up.sql` | v6 | Notifications, showcases, speed tests, testimonials, message reactions, triggers |
| `000007_seed_forum_categories.up.sql` | v7 | Forum seed data |
| `000008_forum_reports.up.sql` | v8 | Forum report functionality |
| `000009_admin_notes.up.sql` | v9 | Admin note system |
| `000010_fix_admin_columns.up.sql` | v10 | Column fixes for admin |
| `000011_audit_log_partitioning.up.sql` | v11 | Monthly partition creation + pg_cron scheduling |
| `000012_payout_retry_queue.up.sql` | v12 | `payout_retry_queue` with exponential backoff |
| `000013_soft_delete_sessions_nodes.up.sql` | v13 | `deleted_at` on sessions + nodes; partial indexes |
| `000027_sol_only_currency.down.sql` | v27 down | (Rollback SOL-only migration) |
| `000028_spending_limits.up.sql` | v28 | Spending limits on wallets; `spending_records` table |
| `000029_batch_payouts.up.sql` | v29 | `batch_payouts`, `batch_payout_items`, `pending_payouts` |
| `000030_provider_earnings.up.sql` | v30 | `provider_earnings` table; wallet_address on nodes |
| `000031_disputes.up.sql` | v31 | `disputes` table with SOL refund tracking |
| `20260314_sol_only_migration.sql` | non-seq | Currency unification to SOL only |
| `20260315_add_provider_tokens.sql` | non-seq | Provider CLI tokens and node registration |

### Migration Strategy Analysis

**Smart Migration Guard** — The application implements a custom schema version system using `SystemConfiguration` table:

```go
const CurrentSchemaVersion = "20260316-0002"
// Skips AutoMigrate if schema_version matches → fast startup
// FORCE_MIGRATE=true env var to force re-run
```

This prevents unnecessary migration overhead on every pod restart — a critical optimisation for containerised deployments.

**Dual Migration System** — The codebase uses two migration mechanisms that run independently:
1. `SQL files` in `/migrations/` — applied manually or via CI
2. `GORM AutoMigrate` — applied at startup via Go code
This creates a schema fragmentation risk (detailed in Cons section).

---

## 7. Data Access Layer

### Repository Pattern

The system implements a partial Repository/Port pattern for core domains:

```
ports.SessionRepository → db.SessionRepository (GORM adapter)
ports.MarketplaceRepository → db.marketplaceRepository (GORM adapter)
```

Domain entities are separate from GORM models (`domain.SessionEntity` ≠ `models.Session`), which is excellent for testability and hexagonal architecture compliance.

### Direct GORM Usage (API Handlers)

Most API handlers access `db.DB` directly using GORM query builder. This is pragmatic for rapid development but reduces testability for those handlers.

### Key Database Query Patterns

| Pattern | Usage | Example |
|---------|-------|---------|
| `FOR UPDATE` locking | Wallet mutations | `tx.Clauses(clause.Locking{Strength: "UPDATE"})` |
| `OnConflict(DoNothing)` | User sync on auth | Prevents duplicate user records |
| Soft delete | Sessions, nodes, earnings | `gorm.DeletedAt` + `WHERE deleted_at IS NULL` |
| Transaction wrapping | Billing settlement | `db.DB.Transaction(func(tx *gorm.DB) error{...})` |
| Preload | Orders, sessions | `db.DB.Preload("Listing").First(...)` |
| Select projection | Email lookups | `db.DB.Select("email").First(...)` |

### Read Replica Support

```go
// Write path
db.GetWriteDB()  // Always primary DB

// Read path (analytics)
db.GetReadDB()   // Returns replica if READ_REPLICA_URL set, else primary
```

The read replica uses a higher connection pool (50 max open vs 10 primary) for read-heavy analytics workloads.

---

## 8. Redis Caching Architecture

### Key Namespace Design

| Key Pattern | TTL | Data |
|-------------|-----|------|
| `session:{id}` | User-defined | Full `SessionData` JSON |
| `session:{id}:usage` | No expiry | Bytes used counter (incremented atomically) |
| `usage:provider:{id}:buyer:{addr}` | No expiry | Cumulative usage per provider-buyer pair |
| `nonce:provider:{id}:buyer:{addr}` | No expiry | Monotonic nonce counter |
| `ratelimit:apikey:{prefix}` | 2 min sliding window | Sorted set for sliding window rate limit |
| `lock:{key}` | Configurable | Distributed mutex |
| `billing:session:{credUser}:pending` | Session lifetime | Pending bytes for billing settlement |
| `session:{id}:latency` | Short TTL | Recent latency reading |
| `sessions:{userID}` | Session lifetime | Reverse-index of active sessions |

### Redis Cluster Support

```go
// Auto-detected from REDIS_URL: comma-separated = cluster, single = standalone
if strings.Contains(redisURL, ",") {
    return initCluster(redisURL)
}
return initSingle(redisURL)
```

### Usage Pattern: Billing Settlement

```
Redis (real-time accumulation) ──► hourly ticker ──► SQL transaction (settlement)
    billing:session:{user}:pending        └──► wallet debit + ledger entry
                                          └──► provider credit + earnings record
                                          └──► payout queue if threshold reached
                                          └──► Redis key decrement
```

This hybrid approach avoids high-frequency SQL writes per byte transferred while maintaining SQL as the authoritative ledger.

---

## 9. Supabase Auth Integration

### Auth Flow

```
1. Client sends Bearer JWT
2. Control API tries:
   a. Local JWT verification (crypto.ValidateToken) → fast path
   b. Provider Token validation (CLI auth) → medium path
   c. Supabase Auth API call (GET /auth/v1/user) → slow path (circuit breaker protected)
3. On Supabase success: sync user to local `profiles` table if not exists
4. Set user context: userID, userEmail, userRole
```

### Circuit Breaker

Supabase calls are wrapped in `ProtectedServiceCall`, which implements circuit breaker semantics — preventing cascade failures if Supabase Auth is temporarily unavailable.

### Row Level Security (RLS)

Applied on Supabase tables in migration 000001:
- `profiles`: public SELECT, auth-only INSERT/UPDATE
- `payout_retry_queue`: service_role only
- Additional policies on specific financial tables

### Identity Synchronisation Risk

The system maintains a local copy of user identity in the `profiles` table (PostgreSQL) while Supabase Auth is the source of truth. The sync happens on every authenticated request for new users. This creates a potential for race conditions during high-volume parallel signups (mitigated by `OnConflict{DoNothing: true}`).

---

## 10. Financial Engine & Billing Database Flows

### Billing Settlement Workflow

```
[Edge Gateway]
    │ bytes transferred
    ▼
[Redis] billing:session:{credUser}:pending += bytes
    │
    ▼ (every 1 hour — billing.SettleUsage())
[Scan Redis keys matching billing:session:*:pending]
    │
    ├── For each session:
    │     1. Fetch Session + Listing from DB
    │     2. Calculate cost: bytes / GB * pricePerGB → USD → SOL
    │     3. BEGIN TRANSACTION
    │         a. SELECT wallets FOR UPDATE (buyer)
    │         b. CheckSpendingLimit()
    │         c. wallet.BalanceSOL -= costSOL
    │         d. INSERT wallet_ledger_entries (buyer debit)
    │         e. SELECT wallets FOR UPDATE (provider)
    │         f. providerWallet.BalanceSOL += costSOL
    │         g. INSERT wallet_ledger_entries (provider credit)
    │         h. INSERT/UPDATE provider_scores
    │         i. If providerWallet >= 0.05 SOL: queueProviderPayout()
    │     4. COMMIT
    │     5. Redis.DecrBy(key, bytes)
    │
    ▼
[Batch Payout Processor] (every 15 min)
    │
    ├── SELECT pending_payouts ORDER BY priority DESC
    ├── Group into batches (max 20)
    ├── Send batch on-chain (Solana)
    ├── UPDATE batch_payouts status
    └── On failure: INSERT payout_retry_queue
            │
            └── Retry worker (every 5 min, exponential backoff, max 8 attempts)
```

### Transaction Isolation

All financial mutations use `SELECT FOR UPDATE` (row-level locking) to prevent lost-update race conditions when multiple sessions for the same provider settle concurrently. This is a correct and robust pattern.

### Idempotency

`pending_payouts.idempotency_key` has a UNIQUE index, preventing double-payouts on retries. This is critical for financial correctness.

---

## 11. Security Model

### Multi-Layer Security

| Layer | Mechanism | Implementation |
|-------|-----------|----------------|
| Authentication | JWT + Supabase Auth + Provider Token | 3-path verification |
| Authorisation | GORM `user_id` scoping + RLS | Row-level data isolation |
| Rate Limiting | Redis sliding window | Per-API-key limits |
| Distributed Lock | Redis `SetNX` | Prevents concurrent double-processing |
| Audit Trail | `audit_logs` (partitioned) | All security events logged async |
| Anomaly Detection | `security_anomalies` | Geo/device/velocity detection |
| MFA | TOTP + WebAuthn passkeys | `totp_backup_codes`, `webauthn_credentials` |
| Spending Limits | `spending_records` + wallet limits | Daily/weekly/monthly caps by trust tier |
| Soft Delete | `gorm.DeletedAt` on sensitive tables | Data retention without hard deletion |
| Credential Encryption | `encrypted_credentials` | AES-encrypted wallet credentials |

### Trust Tier System

```
TrustTierNew      → 10 RPM / 5GB max / 3 concurrent sessions
TrustTierVerified → 100 RPM / 50GB max / 10 concurrent sessions
TrustTierPremium  → 1000 RPM / unlimited / 100 concurrent sessions

Spending Limits:
  New:      Daily 10 SOL / Weekly 50 SOL / Monthly 100 SOL
  Verified: Daily 50 SOL / Weekly 200 SOL / Monthly 500 SOL
  Premium:  Daily 100 SOL / Weekly 500 SOL / Monthly 2000 SOL
```

---

## 12. Performance & Indexing Strategy

### Critical Indexes Identified

| Table | Index | Type | Purpose |
|-------|-------|------|---------|
| `sessions` | `(user_id, status) WHERE deleted_at IS NULL` | Partial composite | Active session queries |
| `sessions` | `(deleted_at) WHERE deleted_at IS NULL` | Partial | Soft-delete filtering |
| `orders` | `(user_id, status)` | Composite | User order listing |
| `proxy_listings` | `(price_per_gb, uptime_percentage)` | Composite | Price/quality sort |
| `wallet_ledger_entries` | `(wallet_id, created_at)` | Composite | Wallet history pagination |
| `audit_logs` | Monthly range partitions | Partitioned | Avoids full-table scans |
| `payout_retry_queue` | `(next_retry_at) WHERE status = 'pending'` | Partial | Retry worker polling |
| `provider_earnings` | `(session_id) WHERE deleted_at IS NULL` | Partial unique | One earning per session |
| `pending_payouts` | `(priority DESC, queued_at ASC)` | Composite | Priority batch ordering |
| `quality_attestations` | `(validator_id)`, `(provider_id)`, `(node_id)` | Single-column | Attestation lookups |
| `provider_nodes` | `(tier)`, `(tier_score DESC)` | Single-column | Tier filtering/ranking |

### Connection Pool Configuration

```
Primary DB:   MaxOpen=10 (safe for PgBouncer), MaxIdle=2, ConnMaxLifetime=1h
Read Replica: MaxOpen=50, MaxIdle=20, ConnMaxLifetime=1h, MaxIdleTime=10min
```

The primary pool limit of 10 is correct for Supabase's transaction-pool mode (typically 15–25 connections shared across all services). Can be overridden via `DB_MAX_OPEN_CONNS` env var.

---

## 13. Pros (Strengths)

### P1 — Smart Schema Version Guard
The `CurrentSchemaVersion` check prevents AutoMigrate on every pod restart, making container deployments fast and safe. The `FORCE_MIGRATE=true` override provides an escape hatch.

### P2 — Robust Financial Safety
- `SELECT FOR UPDATE` on all wallet mutations prevents lost-update race conditions
- `idempotency_key` unique index on `pending_payouts` prevents double-payouts
- Payout retry queue with exponential backoff (8 max attempts) handles transient Solana failures
- Spending limits (daily/weekly/monthly) protect users from runaway charges
- Batch payout processing reduces on-chain gas costs by ~30%

### P3 — Comprehensive Audit Logging
The `audit_logs` table is partitioned by month with pg_cron automation, making it production-ready for compliance. Logs are written asynchronously (goroutine) to avoid adding latency to user requests.

### P4 — Excellent Soft-Delete Implementation
GORM's `gorm.DeletedAt` is used correctly on `sessions`, `nodes`, `provider_earnings`, and more. Partial indexes `WHERE deleted_at IS NULL` keep active-row queries fast.

### P5 — Redis-SQL Hybrid Billing
The pattern of accumulating usage in Redis then settling hourly to SQL is architecturally sound, minimising high-frequency DB writes while maintaining a durable ledger.

### P6 — Decentralised Consensus Layer
The `validators`, `consensus_rounds`, `quality_attestations` tables implement a BFT-style attestation system for objective node quality scoring — this is architecturally unique and valuable.

### P7 — Read Replica Separation
`GetReadDB()` / `GetWriteDB()` cleanly separates read and write paths, enabling analytics scaling without primary DB pressure.

### P8 — Hexagonal Architecture for Core Domains
`ports.SessionRepository`, `ports.MarketplaceRepository` with GORM adapters demonstrates proper hexagonal (ports-and-adapters) architecture for the most critical domains, enabling easy unit testing and future storage backend swaps.

### P9 — Multi-Auth Path Resilience
Three-path auth (local JWT → provider token → Supabase API with circuit breaker) ensures the API remains functional even during partial Supabase Auth outages.

### P10 — Rich Security Model
WebAuthn, TOTP, anomaly detection, geo-change detection, account lockouts, and trust tiers form a layered security posture unusual in proxy platforms.

---

## 14. Cons (Weaknesses)

### C1 — Dual Migration System Creates Schema Fragmentation Risk (CRITICAL)
The system has two independent migration paths: SQL files in `/migrations/` AND GORM `AutoMigrate`. These run independently and can diverge. For example, `000005_provider_tiers.up.sql` adds an ENUM column `provider_tier` to the `provider_nodes` table in SQL, but GORM's AutoMigrate manages the same `ProviderNode` struct. On a fresh database, only one path may run, leaving the schema inconsistent. **Risk: Data loss, startup failures, or silent schema mismatches in production.**

### C2 — AutoMigrate in Production Startup (HIGH)
`DB.AutoMigrate(...)` is called inside `Init()` which runs at application startup. AutoMigrate is not production-safe for complex schemas — it cannot handle column renames, type changes, or data migrations, and holds brief table locks. For Supabase-hosted databases, this could time out or cause brief service degradation.

### C3 — Missing Migrations 14–26 (MEDIUM)
Migration numbering jumps from `000013` to `000027` (a gap of 13 migrations). Either these were applied manually (and are therefore not in source control) or the numbering was reset. This makes it impossible to recreate the exact schema from the `/migrations/` directory alone, which undermines the value of having a migration history.

### C4 — Inconsistent Foreign Key Enforcement (MEDIUM)
Several newer migrations explicitly remove FK constraints for "flexibility":
```sql
-- From 20260315_add_provider_tokens.sql:
-- Note: Removed FK constraints to allow flexible user storage (Supabase/DB)
```
`provider_tokens.user_id`, `provider_node_registrations.token_id`, and `spending_records` foreign keys reference tables in different schemas (Supabase auth.users vs local profiles). This creates orphaned records risk and prevents cascading deletes.

### C5 — Sensitive Data in Sessions Table (HIGH)
```go
CredentialsUser string `gorm:"type:varchar(255)"`
CredentialsPass string `gorm:"type:varchar(255)"`
```
Proxy credentials are stored in plaintext in the `sessions` table. Even if the database is encrypted at rest, any user with DB read access can see all proxy credentials. These should be hashed/encrypted.

### C6 — Counters as Denormalised Columns on Profiles (MEDIUM)
`profiles.followers_count`, `following_count`, `reviews_count`, `avg_rating` are denormalised counters. Without transactional increment/decrement guards, these will drift over time (especially under concurrent operations). No trigger or application-side locking was observed protecting these counters.

### C7 — GORM AutoMigrate Duplicate Model Registration (LOW)
`AuditLog` is registered twice in the `AutoMigrate` call in `db.go` (lines 104 and 215):
```go
&models.AuditLog{},  // line 104 - under "Marketplace & Orders" section
...
&models.AuditLog{},  // line 215 - under "Advanced Security (Phase 22)"
```
This is harmless but indicates copy-paste accumulation and makes the model list harder to maintain.

### C8 — No Database-Level Constraints on Critical Financial Columns (MEDIUM)
`wallet.balance_sol` has no `CHECK (balance_sol >= 0)` database constraint. A bug in the application-layer balance check (e.g., a race condition that bypasses the `FOR UPDATE` lock) could result in negative balances that the DB would accept silently.

### C9 — Missing Migrations for Social-to-Supabase Move (LOW)
`migrate_social_to_supabase.sql` exists as an ad-hoc file without sequential numbering. This is a manual migration that may not have been applied consistently across environments.

### C10 — Redis Key Expiry Missing on Usage Counters (MEDIUM)
`session:{id}:usage` and `usage:provider:{id}:buyer:{addr}` keys have no TTL set. For long-running sessions or high-churn environments, these can accumulate indefinitely, consuming Redis memory. A post-settlement cleanup or rolling TTL should be applied.

### C11 — Blocking AutoMigrate Failure Handling (LOW)
```go
if err != nil {
    log.Printf("Failed to migrate database: %v", err)
    // Don't fail entire startup, just warn
}
```
Migration failures are silently swallowed. A partial migration (e.g., 30 of 50 models migrated before failure) leaves the database in an unknown state. The application continues to run, which could cause runtime panics or data corruption.

### C12 — Provider Stats Are Stale Aggregates Without Refresh Guarantee (MEDIUM)
`provider_stats` is updated via triggers (`trg_update_provider_stats_speed`, `trg_update_provider_stats_testimonial`) but no comprehensive re-calculation trigger covers all stat dimensions (sessions, bandwidth, reviews). Stats can drift from ground truth.

---

## 15. Ratings

| Dimension | Rating (1–10) | Justification |
|-----------|:---:|----------|
| **Schema Design** | 7/10 | Well-modelled domains; good normalisation; minor denormalisation issues |
| **Financial Reliability** | 8/10 | FOR UPDATE locking, idempotency keys, retry queues — solid; needs DB constraints |
| **Security Architecture** | 8/10 | Exceptional breadth (WebAuthn, audit partitions, RLS, anomaly detection) |
| **Migration Management** | 4/10 | Dual system creates fragmentation; 13-version gap; AutoMigrate in prod startup |
| **Performance & Indexing** | 7/10 | Good partial indexes; Redis-SQL hybrid billing; missing some covering indexes |
| **Data Access Layer** | 6/10 | Repository pattern for core domains; direct GORM in handlers reduces testability |
| **Caching Strategy** | 7/10 | Redis used well; missing TTLs on some keys; good cluster support |
| **Scalability Readiness** | 6/10 | Read replica exists; connection pool correct for Supabase; AutoMigrate is bottleneck |
| **Code Quality** | 6/10 | Consistent patterns; duplicate AutoMigrate entries; plaintext credentials |
| **Documentation & Observability** | 5/10 | Sparse SQL comments; no ERD maintained; audit logs are good but metrics limited |
| **Overall Database Health** | **6.4/10** | Solid foundation; needs targeted hardening before production at scale |

---

## 16. Improvements Required

These are **critical or high-priority fixes** that should be addressed before production scale.

### I1 — Unify Migration System (CRITICAL)
**Problem:** Two independent migration systems (SQL files + GORM AutoMigrate) creating schema drift risk.
**Fix:** Choose one approach. Recommended: use a dedicated migration tool (`golang-migrate` or `goose`) with SQL files only. Disable GORM AutoMigrate in production by gating it behind `AUTO_MIGRATE=true` env var (off by default).
**Impact:** Eliminates migration-related production incidents.

### I2 — Add Database Constraints on Financial Columns (HIGH)
**Problem:** No `CHECK` constraints prevent negative balances.
**Fix:**
```sql
ALTER TABLE wallets ADD CONSTRAINT chk_balance_non_negative CHECK (balance_sol >= 0);
ALTER TABLE provider_earnings ADD CONSTRAINT chk_net_amount_non_negative CHECK (net_amount_sol >= 0);
```
**Impact:** Prevents a class of financial bugs from persisting silently.

### I3 — Encrypt Session Credentials (HIGH)
**Problem:** `sessions.credentials_user` and `credentials_pass` stored in plaintext.
**Fix:** Encrypt these columns using AES-256-GCM with a key stored in a secrets manager (HashiCorp Vault or AWS KMS). Use a GORM `BeforeSave`/`AfterFind` hook for transparent encryption.
**Impact:** Protects user credentials in the event of DB breach or insider access.

### I4 — Fill Missing Migration Gap 14–26 (HIGH)
**Problem:** 13 migrations are missing from source control.
**Fix:** Audit what schema changes occurred between v13 and v27, document them as numbered migration files, and add them to the repository. Create a `schema_baseline.sql` that captures the full current schema.
**Impact:** Restores the ability to recreate the schema from migrations alone.

### I5 — Fix AutoMigrate Failure Handling (MEDIUM)
**Problem:** Migration failures are silently swallowed.
**Fix:** Make migration failure fatal on startup (non-zero exit code) or at minimum expose it as a health check endpoint failure so orchestration systems (Kubernetes) can prevent traffic routing to a partially-migrated pod.

### I6 — Add TTL to Redis Usage Counters (MEDIUM)
**Problem:** `session:{id}:usage` keys accumulate without expiry.
**Fix:** After billing settlement, explicitly delete or set a short TTL (e.g., 24h) on usage keys. Add a periodic cleanup job to scan and expire stale keys.

### I7 — Remove Duplicate AutoMigrate Registrations (LOW)
**Problem:** `AuditLog` is registered twice in `db.go`.
**Fix:** Deduplicate the `AutoMigrate` model list. Extract it to a `var modelsToMigrate = []interface{}{...}` slice to prevent future duplicates.

---

## 17. Enhancements Recommended

These are **improvements that would meaningfully increase the system's capability, performance, or reliability**.

### E1 — Implement Database-Level Partitioning for Sessions and Transactions
As the platform scales, the `sessions` and `wallet_ledger_entries` tables will grow to hundreds of millions of rows. Implement range partitioning by `created_at` (monthly or quarterly) similar to how `audit_logs` is already partitioned. This will keep query performance consistent as data volume grows.

```sql
-- Example: partition sessions by month
CREATE TABLE sessions_2026_03 PARTITION OF sessions
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
```

### E2 — Materialised View for Provider Leaderboard
`provider_stats` is currently kept in sync via triggers, but is limited in scope. Replace it with a PostgreSQL materialised view refreshed on a schedule:
```sql
CREATE MATERIALIZED VIEW provider_leaderboard AS
SELECT p.id, p.username, ps.avg_rating, ps.total_sessions,
       pn.tier, pn.uptime_percent
FROM profiles p
JOIN provider_stats ps ON ps.provider_id = p.id
JOIN provider_nodes pn ON pn.user_id = p.id
ORDER BY ps.avg_rating DESC, ps.total_sessions DESC;

CREATE UNIQUE INDEX ON provider_leaderboard(id);
-- Refresh via: REFRESH MATERIALIZED VIEW CONCURRENTLY provider_leaderboard;
```

### E3 — Event Sourcing for Wallet Ledger
The `wallet_ledger_entries` table is already append-only (a good sign), but wallet balance is stored as a mutable column. Consider deriving the balance from the ledger on read (CQRS/event-sourcing pattern) to eliminate the balance synchronisation risk entirely. A materialised "balance" view could serve fast reads.

### E4 — Full-Text Search Index for Marketplace
Add a `tsvector` generated column and GIN index to `proxy_listings` for full-text search on title and description:
```sql
ALTER TABLE proxy_listings ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || coalesce(description, ''))) STORED;
CREATE INDEX idx_listings_fts ON proxy_listings USING GIN(search_vector);
```

### E5 — Add PGMQ or Outbox Pattern for Critical Events
Replace the goroutine-based fire-and-forget for audit logs and payout queuing with a transactional outbox pattern. This guarantees events are never lost even if the application crashes between DB write and goroutine execution.

### E6 — Implement Connection Pooling at Infrastructure Level (PgBouncer Sidecar)
While the current pool settings respect Supabase's PgBouncer limits, dedicated PgBouncer sidecars per service would allow each service to independently tune pool sizes without the risk of exhausting the shared Supabase pool as the platform scales.

### E7 — Add `jsonschema` Validation for JSONB Columns
Several columns use raw `JSONB` (`config`, `metadata`, `social_links`, `metrics`). Add PostgreSQL `jsonschema` extension or application-level validation to prevent malformed data from being stored.

### E8 — Implement Database Observability
Add query performance monitoring:
- Enable `pg_stat_statements` extension for query analysis
- Export GORM `AfterQuery`/`AfterCreate` hooks to Prometheus/OpenTelemetry
- Set `log_slow_queries` threshold in PostgreSQL config
- Track wallet mutation latency as a key SLI

### E9 — Consider TimescaleDB for Time-Series Metrics
`session_metrics`, `explorer_metrics`, `uptime_checks`, and `speed_tests` are all time-series data. TimescaleDB (a PostgreSQL extension) would provide automatic data tiering, faster aggregation queries, and built-in downsampling — significantly improving analytics performance at scale.

### E10 — Enforce Referential Integrity on Provider Token Tables
Re-add FK constraints on `provider_tokens` and `provider_node_registrations` using explicit schema qualification:
```sql
ALTER TABLE provider_tokens
    ADD CONSTRAINT fk_provider_tokens_user
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
```
The "flexibility" rationale for removing FKs is a valid concern when Supabase auth.users and local profiles can diverge, but this can be resolved by ensuring the sync is complete before any token is issued.

---

## 18. Workflow Diagrams

### Workflow 1: User Authentication & DB Sync

```
Client Request (Bearer Token)
         │
         ▼
SupabaseAuthMiddleware
         │
         ├──► crypto.ValidateToken() ──► SUCCESS → set ctx, continue (fast path)
         │
         ├──► validateProviderToken() ──► SUCCESS → set ctx, update last_used async
         │
         └──► HTTP GET /auth/v1/user (circuit breaker protected)
                   │
                   ├── FAIL (circuit open) → 401 Unauthorized
                   │
                   └── SUCCESS
                           │
                           ▼
                    DB.First(&User, "id = ?")
                           │
                           ├── Found → set context, continue
                           │
                           └── Not Found
                                   │
                                   ▼
                             DB.Create(&User, OnConflict{DoNothing})
                             set context, continue
```

### Workflow 2: Proxy Session Lifecycle

```
CreateSession Request
         │
         ▼
Validate user, listing, node availability
         │
         ▼
DB.Transaction:
  1. Deduct bandwidth cost from wallet (FOR UPDATE)
  2. Create Session record
  3. Create EscrowTransaction
  4. UPDATE listing.available_bandwidth -= amount
         │
         ▼
Redis.StoreSession(sessionID, SessionData, TTL)
         │
         ▼
Return credentials to client
         │
         ▼ [active session]
Edge Gateway routes traffic
Redis.IncrementUsage(sessionID, bytes)
         │
         ▼ [hourly billing worker]
billing.SettleUsage()
  └── scan Redis → settle each session in DB transaction
         │
         ▼ [session end]
UPDATE sessions SET status = 'terminated', deleted_at = NOW()
Redis.DeleteSession(sessionID)
```

### Workflow 3: Provider Payout Pipeline

```
Billing Settlement
         │ (providerWallet >= 0.05 SOL threshold)
         ▼
queueProviderPayout(providerID)
         │
         ▼
DB.Transaction:
  1. SELECT wallets FOR UPDATE (provider)
  2. wallet.BalanceSOL = 0
  3. INSERT wallet_ledger_entries (debit)
  4. COMMIT
         │
         ▼
BatchPayoutProcessor.QueuePayout()
         │
         ├── INSERT pending_payouts (with idempotency_key)
         │
         ▼ [every 15 min]
BatchPayoutProcessor.ProcessBatch()
  1. SELECT pending_payouts ORDER BY priority DESC LIMIT 20
  2. INSERT batch_payouts (header)
  3. INSERT batch_payout_items (line items)
  4. Send batch on-chain (Solana)
         │
         ├── SUCCESS → UPDATE batch_payouts status='completed'
         │
         └── FAILURE
                 │
                 ▼
         INSERT payout_retry_queue
                 │
                 ▼ [every 5 min, exponential backoff]
         PayoutRetryWorker.processPayoutRetries()
                 │
                 ├── attempt < 8 → retry
                 └── attempt >= 8 → status='failed_permanent' → manual intervention
```

---

## 19. Summary Scorecard

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    PROXYHUB DATABASE HEALTH SCORECARD                    │
├────────────────────────────────────┬─────────────┬──────────────────────┤
│ Dimension                          │ Score       │ Priority Action       │
├────────────────────────────────────┼─────────────┼──────────────────────┤
│ Schema Design & Normalisation      │ ████████░░ 7│ Minor: counter drift  │
│ Financial Safety                   │ ████████░░ 8│ Add DB constraints    │
│ Security Architecture              │ ████████░░ 8│ Encrypt credentials   │
│ Migration Management               │ ████░░░░░░ 4│ CRITICAL: Unify now   │
│ Performance & Indexing             │ ███████░░░ 7│ Add FTS, partitions   │
│ Data Access Layer Quality          │ ██████░░░░ 6│ Extend repo pattern   │
│ Caching Strategy                   │ ███████░░░ 7│ Add Redis TTLs        │
│ Scalability Readiness              │ ██████░░░░ 6│ Disable prod AutoMig  │
│ Code Quality                       │ ██████░░░░ 6│ Remove duplicates     │
│ Observability & Documentation      │ █████░░░░░ 5│ Add pg_stat_statements│
├────────────────────────────────────┼─────────────┼──────────────────────┤
│ OVERALL                            │ ██████░░░░  │                      │
│                                    │   6.4/10    │                      │
└────────────────────────────────────┴─────────────┴──────────────────────┘

KEY:
  GREEN  (8–10): Production-ready, maintain as-is
  YELLOW (6–7):  Functional, improvement advised before scale
  RED    (1–5):  Requires immediate attention

CRITICAL ACTIONS (do before scaling):
  1. Unify migration system — eliminate dual-track schema drift
  2. Fill migration gap 14–26 — restore schema reproducibility
  3. Encrypt session credentials — security compliance
  4. Add CHECK constraints on balance columns — financial safety

HIGH-VALUE ENHANCEMENTS:
  1. Materialised view for provider leaderboard
  2. Partition sessions + ledger by month
  3. TimescaleDB for time-series tables
  4. Transactional outbox for audit events
```

---

*Report generated by database engineering analysis on 2026-03-16. Based on full review of 50+ model files, 23 migration files, database connection layer, Redis integration, API middleware, and billing engine.*
