# ProxyHub — Database Split Analysis Report
**Date:** 2026-03-16
**Analyst:** Claude (automated analysis of schema, access patterns & code)
**Scope:** 96 tables across Docker PostgreSQL + planned Supabase migration

---

## Executive Summary

The system currently has **96 tables all living in Docker PostgreSQL**. The codebase already has a split architecture implemented in `internal/db/social.go` — it defines which tables should route to Supabase (via `Social()` call) vs stay local (via `DB()` call). However, **Supabase is not yet connected** (`SUPABASE_DATABASE_URL` not set), so everything falls back to local PostgreSQL.

The split logic is already correct at the code level. This report confirms, refines, and documents the split decision for each table.

**Recommended split:**
- **55 tables → Stay on Docker PostgreSQL** (latency-sensitive, financial, auth, high-frequency writes)
- **41 tables → Move to Supabase** (social, community, content, async)

---

## Tier Classification

### ⚡ TIER 1 — MUST STAY ON DOCKER POSTGRESQL
> Sub-millisecond access required. Financial integrity, auth, or real-time data paths. Any latency here directly impacts the user experience or causes money loss.

---

#### 🔐 Authentication & Security (9 tables)

| Table | Reason to Stay Local |
|---|---|
| `profiles` | Read on **every authenticated request** (JWT validation + profile lookup). Supabase adds 20–80ms round-trip latency per request. |
| `user_sessions` | Session tokens validated on every API call. Must be sub-millisecond. |
| `refresh_token_families` | Token rotation on every refresh — race condition if remote. |
| `api_keys` | Validated on every API request in middleware. |
| `login_attempts` | Rate-limiting depends on this — must be local to be effective. |
| `account_lockouts` | Same as login_attempts — security enforcement is instant. |
| `webauthn_credentials` | Used during FIDO2 auth ceremonies — latency breaks the flow. |
| `totp_backup_codes` | One-time codes — must atomically validate+invalidate locally. |
| `encrypted_credentials` | Crypto key material used during sessions. Never leave the local network. |

---

#### 💰 Financial Core (12 tables)
> All writes must be ACID-compliant with rollback capability. No remote DB risk here.

| Table | Reason to Stay Local |
|---|---|
| `wallets` | Real-time SOL balance reads and writes. Every checkout, payout, and session touches this. |
| `wallet_ledger_entries` | Append-only financial audit trail. Must be consistent with wallet balance. |
| `orders` | Marketplace orders — atomic create + payment deduction in single transaction. |
| `escrow_transactions` | Escrow state must be consistent. Mid-transaction remote failure = fund loss. |
| `escrow_disputes` | Dispute resolution queries escrow state atomically. |
| `pending_transactions` | In-flight on-chain transactions. Polled every few seconds by workers. |
| `pending_payouts` | Billing worker polls this every minute. Local = reliable. |
| `batch_payouts` | Batch payout orchestration — needs fast coordination between worker threads. |
| `batch_payout_items` | Line items of batch payouts — must stay with `batch_payouts`. |
| `provider_earnings` | Credited per session end. Written at very high frequency during active traffic. |
| `payout_retry_queues` | Retry queue — workers poll this in tight loops. |
| `spending_records` | Spending limit enforcement — must be read atomically with orders. |

---

#### 📡 Provider Infrastructure (13 tables)
> Nodes send heartbeats every 30s. Sessions open and close continuously. All of this is high-frequency operational data.

| Table | Reason to Stay Local |
|---|---|
| `nodes` | Node registry — read on every session match, gateway routing decision. |
| `provider_nodes` | Provider-facing node management — heartbeat updates every 30s per node. |
| `provider_node_registrations` | Written when a node first connects. Referenced by auth middleware. |
| `provider_tokens` | CLI auth tokens — validated on every CLI connection. |
| `provider_applications` | Tier evaluation — read by worker every few minutes. |
| `sessions` | **Highest write frequency table.** One row open+close per proxy session. |
| `session_configurations` | Read at session open time to configure the connection. |
| `session_metrics` | Written continuously during active sessions (bandwidth stats). |
| `service_configurations` | Configuration read by edge gateway on every request routing. |
| `routing_profiles` | Used by smart routing engine per connection. |
| `proof_of_services` | Written at session close — billing proof. |
| `quality_attestations` | Written per session by reputation engine. |
| `usage_records` | Usage accounting — written per session, read by billing worker. |

---

#### 🔗 Blockchain & Explorer (7 tables)
> The blockchain indexer writes ~1000 tx/s during sync. These tables can never be remote.

| Table | Current Size | Reason to Stay Local |
|---|---|---|
| `explorer_transactions` | **554 MB / ~1M rows** | Highest data volume. Indexed by the local blockchain indexer at very high write rate. |
| `blockchain_state_cache` | **27 MB / ~57K rows** | In-memory cache materialized to disk. Invalidated frequently. |
| `explorer_blocks` | **6.4 MB / ~27K rows** | Written by indexer per block (~400ms intervals on Solana). |
| `explorer_contracts` | 48 KB | Contract registry — cross-referenced by tx indexer. |
| `explorer_nodes` | 24 KB | Node geography data — synced by node_sync worker. |
| `explorer_metrics` | 16 KB | Aggregate metrics polled by monitoring dashboard. |
| `usage_proofs` | 32 KB | Cryptographic proofs — must stay with `proof_of_services`. |

---

#### 🛒 Marketplace (6 tables)
> Listing queries happen on every marketplace page load. Orders are financially atomic.

| Table | Reason to Stay Local |
|---|---|
| `proxy_listings` | Read on every marketplace search — performance critical. |
| `proxy_pools` | Pool availability checked on every session match. |
| `disputes` | Provider dispute resolution — must be ACID with orders. |
| `dispute_juries` | Jury selection — complex join with disputes. |
| `saved_listings` | Checked on marketplace loads — co-located with listings for JOINs. |
| `staking_positions` | Staking state — joins with wallets for balance checks. |

---

#### ⚙️ System & Administration (9 tables)

| Table | Reason to Stay Local |
|---|---|
| `audit_logs` | Written on every sensitive operation. Must never be lossy. |
| `admin_notes` | Internal moderation tool — co-located with audit_logs. |
| `system_configurations` | Read on startup and config reload. |
| `cli_downloads` | Read when provider downloads CLI binary. |
| `linked_wallets` | External wallet links — read during wallet operations. |
| `security_anomalies` | Security event log — must be immediately available to the anomaly detector. |
| `consensus_rounds` | Validator consensus — real-time, multi-writer. |
| `validators` | Validator registry — read per consensus round. |
| `miner_weights` | Updated by reputation manager — tight loop with validators. |

---

### ☁️ TIER 2 — MOVE TO SUPABASE
> These tables are either user-generated content, community features, or async data. A 30–80ms latency is acceptable. Supabase's real-time subscriptions and REST API are a bonus here.

---

#### 👥 Social Graph (7 tables)
*Already routed to `Social()` in social.go*

| Table | Why Supabase is Fine |
|---|---|
| `follows` | Read on profile pages — not in the critical request path. |
| `friend_requests` | Async user action — latency invisible. |
| `friendships` | Read infrequently (friend list page). |
| `badges` | Badge definitions — read rarely, cached in memory. |
| `user_badges` | Badge awards — background event, not in hot path. |
| `feed_events` | Social feed generation — async, precomputable. |
| `reviews` | Written once per order — read on marketplace detail pages. |

---

#### 🔔 Notifications (2 tables)
*Already routed to `Social()` in social.go*

| Table | Why Supabase is Fine |
|---|---|
| `notifications` | Delivered via WebSocket push — the delivery is async, DB insert can be slightly delayed. |
| `notification_preferences` | Read only when sending notifications — background process. |

---

#### 🗣️ Forum (4 tables)
*Already routed to `Social()` in social.go*

| Table | Why Supabase is Fine |
|---|---|
| `forum_categories` | Static-ish lookup — could even be Redis-cached. |
| `forum_threads` | Community content — user-tolerant of 100–200ms loads. |
| `forum_posts` | Same as threads. |
| `forum_votes` | Upvotes — eventual consistency is fine. |

---

#### 💬 Messaging (3 tables)
*Already routed to `Social()` in social.go*

| Table | Why Supabase is Fine |
|---|---|
| `conversations` | Read on DM page open — acceptable latency. |
| `messages` | **Supabase Realtime is actually better here** — native WebSocket push. |
| `message_reactions` | Emoji reactions — very tolerant of latency. |

---

#### 🏘️ Community Circles (7 tables)
*Already routed to `Social()` in social.go*

| Table | Why Supabase is Fine |
|---|---|
| `circles` | Community groups — read on community pages. |
| `circle_members` | Membership lookup — occasional. |
| `circle_invites` | Invite management — async. |
| `circle_slas` | SLA agreements — read on circle detail page. |
| `circle_stats` | Aggregate stats — precomputed, tolerant of delay. |
| `circle_posts` | Community posts — social content. |
| `circle_leases` | Circle resource leases — low-frequency. |

---

#### 📋 Subscriptions (2 tables)
*Already routed to `Social()` in social.go*

| Table | Why Supabase is Fine |
|---|---|
| `subscription_plans` | Read on pricing page — static-ish. |
| `user_subscriptions` | Checked during feature gate — could be Redis-cached after first read. |

---

#### 🏛️ Governance (2 tables)
*Already routed to `Social()` in social.go*

| Table | Why Supabase is Fine |
|---|---|
| `governance_proposals` | DAO proposals — read on governance page, not in hot path. |
| `governance_votes` | Voting — async, finality not immediate. |

---

#### 🤖 AI Agents (5 tables)
*Already routed to `Social()` in social.go*

| Table | Why Supabase is Fine |
|---|---|
| `agents` | Agent registry — read on AI marketplace. |
| `agent_outputs` | LLM outputs — large blobs, slow writes acceptable. |
| `market_agents` | Marketplace listings for agents. |
| `agent_instances` | Running agent instances — polled every few seconds but not sub-ms. |
| `agent_jobs` | Background jobs — queue-based, async. |

---

#### 🧩 Smart Matching (3 tables)
*Already routed to `Social()` in social.go*

| Table | Why Supabase is Fine |
|---|---|
| `use_cases` | Matching criteria definitions — read on match setup. |
| `user_preferences` | Matching preferences — read during match, pre-computed. |
| `match_requests` | Match results — computed async, result stored and read later. |

---

#### 📊 Provider Social (4 tables)
*Already routed to `Social()` in social.go*

| Table | Why Supabase is Fine |
|---|---|
| `provider_showcases` | Provider profiles on marketplace — not in core session path. |
| `speed_tests` | Historical test results — read on provider detail page. |
| `testimonials` | User testimonials — display only. |
| `provider_stats` | Aggregate stats — pre-computed, refreshed periodically. |

---

#### ⚙️ User Preferences (1 table — NOT YET in social.go, should move)

| Table | Recommendation |
|---|---|
| `user_settings` | Read on settings page and during onboarding. Not in the auth or session hot path. **Should be added to `Social()` in social.go.** |

---

## Summary Table

| Category | Count | Location | Tables |
|---|---|---|---|
| Auth & Security | 9 | **PostgreSQL** | profiles, user_sessions, refresh_token_families, api_keys, login_attempts, account_lockouts, webauthn_credentials, totp_backup_codes, encrypted_credentials |
| Financial Core | 12 | **PostgreSQL** | wallets, wallet_ledger_entries, orders, escrow_transactions, escrow_disputes, pending_transactions, pending_payouts, batch_payouts, batch_payout_items, provider_earnings, payout_retry_queues, spending_records |
| Provider Infrastructure | 13 | **PostgreSQL** | nodes, provider_nodes, provider_node_registrations, provider_tokens, provider_applications, sessions, session_configurations, session_metrics, service_configurations, routing_profiles, proof_of_services, quality_attestations, usage_records |
| Blockchain & Explorer | 7 | **PostgreSQL** | explorer_transactions, blockchain_state_cache, explorer_blocks, explorer_contracts, explorer_nodes, explorer_metrics, usage_proofs |
| Marketplace | 6 | **PostgreSQL** | proxy_listings, proxy_pools, disputes, dispute_juries, saved_listings, staking_positions |
| System & Admin | 9 | **PostgreSQL** | audit_logs, admin_notes, system_configurations, cli_downloads, linked_wallets, security_anomalies, consensus_rounds, validators, miner_weights |
| **PostgreSQL Total** | **56** | | |
| Social Graph | 7 | **Supabase** | follows, friend_requests, friendships, badges, user_badges, feed_events, reviews |
| Notifications | 2 | **Supabase** | notifications, notification_preferences |
| Forum | 4 | **Supabase** | forum_categories, forum_threads, forum_posts, forum_votes |
| Messaging | 3 | **Supabase** | conversations, messages, message_reactions |
| Community Circles | 7 | **Supabase** | circles, circle_members, circle_invites, circle_slas, circle_stats, circle_posts, circle_leases |
| Subscriptions | 2 | **Supabase** | subscription_plans, user_subscriptions |
| Governance | 2 | **Supabase** | governance_proposals, governance_votes |
| AI Agents | 5 | **Supabase** | agents, agent_outputs, market_agents, agent_instances, agent_jobs |
| Smart Matching | 3 | **Supabase** | use_cases, user_preferences, match_requests |
| Provider Social | 4 | **Supabase** | provider_showcases, speed_tests, testimonials, provider_stats |
| User Settings | 1 | **Supabase** | user_settings *(needs to be added to social.go)* |
| **Supabase Total** | **40** | | |
| **Grand Total** | **96** | | |

---

## Action Items

### Step 1 — Code Fix (1 file)
Add `user_settings` to the `AutoMigrate` list in `internal/db/social.go` so it routes to Supabase when configured.

### Step 2 — Enable Supabase
Set `SUPABASE_DATABASE_URL` in `.env` / Docker env. The fallback in `Social()` means **zero code changes are needed for the rest of the app** — it will automatically start routing to Supabase.

### Step 3 — Migrate Existing Data
Use the provided `migrations/migrate_social_to_supabase.sql` script to dump the 40 social tables from Docker PostgreSQL and import them into Supabase. Run the cleanup section only after verifying data integrity.

### Step 4 — Disk Reclaim
After migration and verification, drop the 40 social tables from Docker PostgreSQL. `explorer_transactions` (554 MB) stays local — it alone accounts for ~90% of the DB disk usage.

---

## Key Observation: Explorer Transactions

The `explorer_transactions` table at **554 MB with ~1 million rows** is the single largest table and grows continuously as the Solana blockchain indexer runs. This table must always stay on Docker PostgreSQL — it is write-heavy (new blocks every ~400ms), requires complex JOIN queries with `explorer_blocks` and `explorer_contracts`, and would incur enormous data transfer costs on any remote database.

---

## Why Supabase Specifically?

The 40 Supabase tables benefit from:
1. **Supabase Realtime** — `messages`, `notifications`, `feed_events` can use native WebSocket subscriptions instead of custom polling
2. **Row-Level Security (RLS)** — social/community data benefits from per-user data isolation at the DB layer
3. **REST API** — Supabase's auto-generated REST API allows the frontend to directly query social data, reducing backend load
4. **Free Tier Headroom** — keeping financial and blockchain data local means Supabase stays within free/low tier limits

---

*Report generated from live Docker PostgreSQL schema (96 tables) + static analysis of `internal/db/social.go`, `internal/api/*.go`, `internal/billing/`, `internal/indexer/`, and `migrations/` directory.*
