# ProxyHubb — Full System Architecture & Analysis Report

**Generated:** 2026-03-16
**Analyst:** Claude Sonnet 4.6 (Expert Proxy Systems Review)
**Codebase:** f:/project/proxyhubb

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Database System](#3-database-system)
4. [API System (Control API)](#4-api-system-control-api)
5. [Proxy Gateway (Edge Gateway)](#5-proxy-gateway-edge-gateway)
6. [Provider System](#6-provider-system)
7. [Consumer System](#7-consumer-system)
8. [Billing System](#8-billing-system)
9. [Transaction System](#9-transaction-system)
10. [Financial System](#10-financial-system)
11. [Frontend](#11-frontend)
12. [Infrastructure & DevOps](#12-infrastructure--devops)
13. [What Is Missing / Incomplete](#13-what-is-missing--incomplete)
14. [What Is Unhealthy / At Risk](#14-what-is-unhealthy--at-risk)
15. [What Is Confusing / Ambiguous](#15-what-is-confusing--ambiguous)
16. [System Rating](#16-system-rating)
17. [Pros & Cons](#17-pros--cons)
18. [Priority Fix & Improvement Roadmap](#18-priority-fix--improvement-roadmap)

---

## 1. Executive Summary

ProxyHubb is a **decentralized proxy network marketplace** that connects proxy bandwidth providers with consumers through a P2P marketplace, with blockchain-native (Solana) financial settlement. It is a three-sided network: **providers** supply bandwidth via registered nodes, **consumers** buy proxy sessions, and the **platform** takes a 10% fee and handles all financial settlement on-chain.

**Key Technologies:**

| Layer | Technology |
|---|---|
| Backend | Go (Gin), PostgreSQL, Redis |
| Gateway | Rust (Hyper + Tokio + Yamux) |
| Frontend | Next.js 16, TypeScript, TanStack Query |
| Blockchain | Solana (oracle escrow, on-chain registry) |
| Auth | Supabase (JWT, OAuth) |
| Messaging | NATS event bus |
| Infra | Docker Compose, Prometheus, Grafana, OpenTelemetry |

**Scale of Codebase:**
- 60+ API handlers (Go)
- 37 SQL migrations
- 15+ Rust gateway modules
- 30+ frontend pages
- Go SDK (`sdks/go/proxyhubb/client.go`)
- Kubernetes infra (`infra/k8s/`)
- Verification scripts (`cmd/verify_flow`, `verify_matching`, `verify_monetization`)

---

## 2. System Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                     FRONTEND  (Next.js 16)                           │
│        Consumer Dashboard / Provider Dashboard / Explorer            │
│                  apps/web  — Port 3000                               │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │ HTTP/REST
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    CONTROL API  (Go / Gin)                           │
│                  services/control-api — Port 8080                    │
│                                                                      │
│  ┌────────────┐  ┌───────────┐  ┌───────────┐  ┌────────────────┐  │
│  │  Sessions  │  │  Wallet   │  │  Orders   │  │   Listings     │  │
│  └────────────┘  └───────────┘  └───────────┘  └────────────────┘  │
│  ┌────────────┐  ┌───────────┐  ┌───────────┐  ┌────────────────┐  │
│  │  Provider  │  │  Escrow   │  │  Explorer │  │   Admin API    │  │
│  │  Earnings  │  │ Disputes  │  │  Indexer  │  │  (Moderation)  │  │
│  └────────────┘  └───────────┘  └───────────┘  └────────────────┘  │
│                                                                      │
│  [Billing] [Treasury] [Solana] [Pricing] [Workers] [Governance]     │
│  [Smart Matching] [Batch Payout] [Reconciliation] [Audit]           │
└──────────┬───────────────────────┬──────────────────────────────────┘
           │                       │
           ▼                       ▼
 ┌──────────────────┐    ┌─────────────────┐    ┌─────────────────┐
 │  PostgreSQL      │    │     Redis        │    │  Supabase Auth  │
 │  (Primary DB)    │    │  Cache/Metering  │    │  & Social DB    │
 │  37 migrations   │    │  Session State   │    │  (Auth + Forum) │
 └──────────────────┘    └─────────────────┘    └─────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                  EDGE GATEWAY  (Rust / Hyper / Tokio)               │
│               services/edge-gateway — Port 8080 proxy               │
│                                                                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │   Auth   │  │  Routing  │  │ Metering │  │  Circuit Breaker   │ │
│  │ (Session)│  │ (Geo/IP)  │  │(Bandwidth│  │  (Fast-fail)       │ │
│  └──────────┘  └───────────┘  └──────────┘  └────────────────────┘ │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │  Tunnel  │  │  Policy   │  │   QoS    │  │  Registry Sync     │ │
│  │  (Yamux) │  │(Domain ACL│  │(Priority)│  │  (Control API)     │ │
│  └──────────┘  └───────────┘  └──────────┘  └────────────────────┘ │
└──────────────────────────┬───────────────────────────────────────────┘
                            │
                            ▼
 ┌────────────────────────────────────────────────┐
 │          PROVIDER CLI DAEMON                   │
 │   cmd/provider-cli — runs on provider machine  │
 │   Heartbeat every 2 min → keeps node online    │
 └────────────────────┬───────────────────────────┘
                       │
                       ▼
 ┌────────────────────────────────────────────────┐
 │          PROVIDER PROXY NODE                   │
 │   Listens on port, forwards consumer traffic   │
 └────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                 SOLANA BLOCKCHAIN (devnet / mainnet)                 │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ Escrow PDAs  │  │  On-Chain    │  │  Treasury Account         │  │
│  │ (per order)  │  │  Registry    │  │  (Oracle-managed oracle)  │  │
│  └──────────────┘  └──────────────┘  └───────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Database System

### 3.1 Schema Design

PostgreSQL is the primary datastore. 37 migrations cover the full schema. Data is split across:

- **Primary DB** (`DATABASE_URL`): all business/financial data
- **Read Replica** (`READ_REPLICA_URL`, optional): analytics queries
- **Supabase Social DB** (`SUPABASE_DATABASE_URL`): forum, messaging, social

### 3.2 Core Domain Models

#### User / Account Layer

| Table | Purpose | Key Fields |
|---|---|---|
| `profiles` | User accounts | id (Supabase UUID), role (buyer/provider/admin), trust_tier |
| `provider_nodes` | Provider proxy nodes | ip, port, location, quality_score, status, uptime_percent |
| `provider_tokens` | CLI auth tokens | token_hash, provider_id, last_used, revoked |

#### Session / Transaction Layer

| Table | Purpose | Key Fields |
|---|---|---|
| `sessions` | Proxy sessions | type (rotating/sticky), status, credentials (encrypted AES-GCM), bandwidth |
| `orders` | Bandwidth purchases | buyer_id, seller_id, bandwidth_gb, price_per_gb, escrow_pda |
| `proxy_listings` | Provider listings | proxy_type, protocol, price_per_gb, tags, quality_score |

#### Financial Layer

| Table | Purpose | Key Fields |
|---|---|---|
| `wallets` | SOL wallet per user | balance_sol (numeric 20,9), daily/weekly/monthly limits |
| `wallet_ledger_entries` | Immutable tx log | amount, balance_after, type, reference_id (Solana sig) |
| `escrow_transactions` | Funds in escrow | status (held/released/refunded/disputed), auto_release_at |
| `escrow_milestones` | Partial releases | byte_threshold, amount, verification_proof |
| `escrow_disputes` | Dispute tracking | reason, resolution, evidence |
| `provider_earnings` | Per-session earnings | gross_sol, net_sol, platform_fee, multiplier, status (pending/paid) |
| `batch_payouts` | Payout batches | status, total_amount, tx_hash, success/failed counts |
| `pending_payouts` | Payout queue | priority, idempotency_key, attempts, last_error |

#### On-Chain Index Layer

| Table | Purpose |
|---|---|
| `explorer_blocks` | Indexed Solana blocks |
| `explorer_transactions` | Indexed transactions |
| `explorer_transaction_events` | Parsed smart contract events |

### 3.3 Database Optimizations

| Optimization | Details |
|---|---|
| Soft Delete | `gorm.DeletedAt` on sessions, nodes, provider_earnings |
| Table Partitioning | `audit_logs` partitioned by month (migration 000011) |
| GIN Indexes | `proxy_listings` for full-text search (migration 000036) |
| Materialized View | `mv_provider_leaderboard` refreshed every 15 min (migration 000035) |
| Connection Pooling | `pgxpool` with configurable max connections |
| Read Replica | Optional split for read-heavy analytics |
| pg_cron | Enabled for scheduled DB jobs (migration 000037) |

### 3.4 Migration History Summary

| Range | Feature Added |
|---|---|
| 000001–000013 | Initial schema: users, sessions, wallets, orders, nodes, audit |
| 000014–000026 | Consolidated: escrow milestones, disputes, governance, social |
| 000027 | SOL-only currency migration |
| 000028 | Spending limits |
| 000029 | Batch payout infrastructure |
| 000030 | Provider earnings per-session tracking |
| 000031 | Dispute system |
| 000032 | Wallet CHECK constraints |
| 000033 | Provider token FK constraints |
| 000034 | Consolidated baseline backfill |
| 000035 | Provider leaderboard materialized view |
| 000036 | Listing full-text search |
| 000037 | pg_cron extension |

---

## 4. API System (Control API)

### 4.1 Architecture

**Framework:** Go + Gin
**Port:** 8080
**Base Path:** `/v1`

**Middleware Stack (applied in order):**

```
1. CORS (origin whitelist + localhost dev fallback)
2. Emergency circuit breaker (kills all traffic if system is failing)
3. OpenTelemetry tracing (Jaeger/OTLP)
4. WAF + DDoS protection
5. Security headers (HSTS, X-Frame-Options, CSP, etc.)
6. Metrics collection (Prometheus)
7. Per-service circuit breakers (DB, Redis, Solana, Supabase)
8. Supabase JWT auth (optional for public routes)
9. RequireAuth (enforced on protected routes)
```

### 4.2 Route Map

#### Public Endpoints (no auth)

```
GET  /v1/health
GET  /v1/listings              — Browse all listings
GET  /v1/listings/search       — Full-text search
GET  /v1/listings/:id          — Single listing
GET  /v1/explorer/blocks       — Chain blocks
GET  /v1/explorer/transactions — Chain txs
GET  /v1/explorer/nodes        — Network node list
GET  /v1/profiles/:id          — Public user profile
GET  /v1/reviews/:listingId    — Listing reviews
GET  /v1/reputation/:userId    — Trust score + badges
GET  /v1/system/config         — Platform config
```

#### Consumer Endpoints (auth required)

```
POST /v1/sessions              — Create proxy session
POST /v1/sessions/instant      — Fast session (no config)
POST /v1/sessions/from-listing — Buy from provider listing
GET  /v1/sessions              — My sessions
GET  /v1/sessions/:id          — Session details
POST /v1/sessions/:id/terminate

GET  /v1/wallet                — Balance + recent txs
POST /v1/wallet/transfer       — P2P transfer
POST /v1/wallet/deposit/crypto — Verify Solana deposit tx
POST /v1/wallet/link           — Link Solana wallet
POST /v1/wallet/withdraw/sol   — Withdraw to wallet
GET  /v1/wallet/limits         — Spending limits
PUT  /v1/wallet/limits         — Update spending limits

POST /v1/orders                — Create bandwidth order
GET  /v1/orders                — My orders
GET  /v1/orders/:id            — Order details
POST /v1/orders/:id/cancel
POST /v1/orders/:id/pay/solana

GET  /v1/escrow/:orderId       — Escrow status
POST /v1/escrow/:orderId/release
POST /v1/escrow/:orderId/dispute
POST /v1/escrow/:orderId/resolve  (admin only)

GET  /v1/usage                 — Bandwidth usage history
GET  /v1/usage/summary         — Summary stats

POST /v1/matching              — Smart node matching
```

#### Provider Endpoints (auth required)

```
GET  /v1/provider/nodes            — My registered nodes
POST /v1/provider/nodes            — Register node
PUT  /v1/provider/nodes/:id        — Update node
DELETE /v1/provider/nodes/:id      — Remove node
GET  /v1/provider/nodes/:id/uptime — 24h uptime stats
POST /v1/provider/nodes/:id/heartbeat — Keep alive (CLI daemon)

POST /v1/provider/tokens           — Create CLI token
GET  /v1/provider/tokens           — List tokens
DELETE /v1/provider/tokens/:id     — Revoke token

GET  /v1/provider/earnings         — Earnings records (paginated)
GET  /v1/provider/earnings/summary — Total earned/pending/paid
GET  /v1/provider/earnings/history — Paid records with tx hash

POST /v1/listings                  — Create listing
PATCH /v1/listings/:id             — Update listing
DELETE /v1/listings/:id            — Delete listing
GET  /v1/suggest-price             — Dynamic price suggestion
```

#### Admin Endpoints (admin JWT required)

```
POST /v1/admin/auth/login          — Admin login (separate JWT)

GET  /v1/admin/users               — All users
POST /v1/admin/users/:id/suspend
POST /v1/admin/users/:id/verify
GET  /v1/admin/nodes               — All nodes (moderation)
GET  /v1/admin/payouts             — Payout queue management
POST /v1/admin/payouts/manual      — Manual payout trigger (stub)
GET  /v1/admin/disputes            — All disputes
POST /v1/admin/disputes/:id/resolve
GET  /v1/admin/audit               — Audit log
GET  /v1/admin/stats               — Platform stats
```

### 4.3 Session Credentials Flow

```
POST /sessions
   → Select healthy provider node (weighted random by quality_score)
   → Generate random username (8 chars) + password (16 chars)
   → Encrypt with AES-GCM (ENCRYPTION_KEY from env)
   → Store encrypted in sessions table
   → Register in Redis + gateway registry
   → Return credentials to consumer
```

---

## 5. Proxy Gateway (Edge Gateway)

### 5.1 Architecture

The edge gateway is a **high-performance Rust reverse proxy** that routes consumer traffic to provider nodes.

**Port layout:**
- `8080` — Proxy traffic (HTTP + CONNECT tunneling)
- `8090` — Management API, metrics, health

### 5.2 Proxy Request Lifecycle

```
1. Consumer connects to edge-gateway:8080
2. Extract credentials from Proxy-Authorization: Basic base64(user:pass)
3. SessionAuthenticator:
   a. Check LRU in-memory cache (fast path)
   b. On miss → Redis lookup → decrypt → cache
   c. On miss → fetch from control-api
4. Validate session: active, within bandwidth limit, not expired
5. PolicyEngine: check domain ACL (allowed_domains / blocked_domains)
6. Routing:
   a. Select provider node (geo/quality weighted)
   b. Circuit breaker check (skip unhealthy nodes)
7. Create Yamux tunnel to provider node
8. Proxy traffic bidirectionally
9. Metering: track bytes_in + bytes_out in Redis
   Redis key: billing:session:{username}:pending
10. On session close: flush pending bytes to control-api
```

### 5.3 Tunnel Protocol (Yamux)

- Yamux is a stream multiplexer over a single TCP connection
- Allows multiple concurrent proxy streams per provider connection
- ProviderCapabilities: max_connections, bandwidth_mbps, features
- AssignedLimits: bandwidth_cap_mbps, qos_tier, priority

### 5.4 Routing Logic

- **Geo routing:** Match consumer's target_geo to node's country/city
- **Quality routing:** Weighted random selection by quality_score
- **Circuit breaker:** Skips nodes with consecutive failures
- **Sticky sessions:** Same node for session lifetime (when type=sticky)
- **Rotating sessions:** New node per request (when type=rotating)

### 5.5 Policy Engine

- Per-session domain ACL (allowed_domains, blocked_domains)
- Rate limiting per session
- Bandwidth cap enforcement
- Protocol filtering (HTTP, HTTPS, SOCKS5)

---

## 6. Provider System

### 6.1 Provider Onboarding Flow

```
1. Sign up → role = buyer (default)
2. Enable provider role in profile
3. POST /provider/nodes → register node IP/port/location
4. POST /provider/tokens → get CLI auth token
5. Install provider-cli on node machine
6. Run: proxyhub-cli daemon --token <token> --node-id <id>
7. CLI sends heartbeat every 2 min → node goes online
8. POST /listings → create marketplace listing (price, type, tags)
9. Consumers buy sessions → provider earns SOL
```

### 6.2 Node Lifecycle

```
offline (registered)
  → online (first heartbeat received)
    → offline (no heartbeat for 5+ minutes)
    → suspended (admin action)
    → deleted (soft-delete)
```

Heartbeat payload:
```json
{
  "latency_ms": 45,
  "active_connections": 12,
  "uptime_percent": 99.7,
  "bandwidth_used_bytes": 10737418240
}
```

### 6.3 Quality Score Algorithm

```
score = 100.0
if latency_ms > 100:
  score -= (latency_ms - 100) * 0.1
score *= success_rate          (0.0–1.0)
score *= uptime_percent / 100
if bandwidth_served_gb > 100:
  score += 10
elif bandwidth_served_gb > 10:
  score += 5
score = clamp(score, 0, 100)
```

### 6.4 Earnings Multiplier Table

| Quality Score | Multiplier | Effect |
|---|---|---|
| ≥ 95 | 1.25 | +25% bonus |
| ≥ 85 | 1.10 | +10% bonus |
| ≥ 75 | 1.00 | Standard |
| ≥ 60 | 0.85 | −15% penalty |
| < 60 | 0.70 | −30% penalty |

### 6.5 Provider CLI (cmd/provider-cli)

Sub-commands:
- `daemon` — Start heartbeat daemon
- `node register` — Register new node
- `node list` — List my nodes
- `wizard` — Interactive setup wizard
- `doctor` — Diagnose CLI/node connectivity
- `update` — Self-update CLI binary
- `version` — Show version info
- `service install/start/stop` — OS service management

### 6.6 Provider CLI Distribution

- Binary built for: Windows/macOS/Linux, x86_64/ARM64
- Available via: `GET /v1/cli/download?os=linux&arch=amd64`
- Versioning and checksum verification
- Self-update endpoint: `GET /v1/cli/latest`

---

## 7. Consumer System

### 7.1 Session Creation Flow

```
Consumer calls POST /sessions
  → Validate wallet balance (can afford bandwidth)
  → SmartMatching: find best node for target_geo + requirements
  → Generate AES-encrypted credentials
  → Create session record (status: active)
  → Register session in Redis cache
  → Return: proxy_host, proxy_port, username, password
```

Consumer configures browser/tool:
```
HTTP Proxy: edge-gateway:8080
Username: <session_username>
Password: <session_password>
```

### 7.2 Session Types

| Type | Behavior | Use Case |
|---|---|---|
| `rotating` | New IP each request | Web scraping |
| `sticky` | Same IP for lifetime | Account management |

### 7.3 Trust Tier Rate Limits

| Tier | Req/Min | Max Bandwidth | Concurrency | Automation |
|---|---|---|---|---|
| new | 10 | 5 GB | 3 | No |
| verified | 100 | 50 GB | 10 | Yes |
| premium | 1,000 | Unlimited | 100 | Yes |

### 7.4 Bandwidth Billing

```
Session active → Redis tracks bytes in real-time
Hourly settlement worker:
  1. Scan Redis: billing:session:*:pending
  2. For each session:
     - bytes = atomic Redis counter
     - costSOL = (bytes / 1e9) * pricePerGB
     - Create WalletLedgerEntry (type: usage, amount: -costSOL)
     - Deduct from wallet.balance_sol
     - Clear Redis pending counter
```

### 7.5 Session Termination

Session ends when:
- Consumer calls `POST /sessions/:id/terminate`
- Bandwidth limit reached
- Wallet balance insufficient
- Provider node goes offline (auto-reroute or terminate)
- Admin suspends session

---

## 8. Billing System

### 8.1 Price Feed

- **Sources:** CoinGecko (primary) → CoinMarketCap (fallback)
- **Cache TTL:** 5 minutes
- **Fallback price:** $150/SOL (conservative hardcoded safety value)
- Used to convert bandwidth costs to SOL

### 8.2 Platform Fee Structure

```
Consumer pays:  bandwidthGB * pricePerGB (in SOL)
Platform takes: 10% of gross
Provider gets:  90% of gross * quality_multiplier
```

Example (100 GB @ $0.05/GB, SOL at $200, quality 85+):
```
grossSOL    = (100 * 0.05) / 200 = 0.025 SOL
platformFee = 0.025 * 0.10 = 0.0025 SOL
netSOL      = (0.025 - 0.0025) * 1.10 = 0.02475 SOL
```

### 8.3 Settlement Worker

Runs every hour:
```
1. Scan all Redis keys: billing:session:*:pending
2. Per session: get bytes used since last settlement
3. Calculate cost in SOL (using current price feed)
4. Write WalletLedgerEntry (debit consumer wallet)
5. Write ProviderEarning (credit provider earning queue)
6. Clear Redis pending counter
```

### 8.4 Batch Payout Processor

Configuration:
```
ImmediateThresholdSOL    = 10.0    (process now if ≥ 10 SOL pending)
MaxBatchSize             = 20      (max 20 providers per batch tx)
MinBatchSize             = 5       (don't process < 5 unless forced)
MaxWaitTime              = 30 min  (max wait before partial batch)
ProcessInterval          = 15 min  (check queue every 15 min)
SingleTransferGasLamports= 5000
BatchTransferGasLamports = 3500    (30% cheaper)
QueueThresholdSOL        = 0.05    (min to enter queue)
```

Processing algorithm:
```
1. Pull pending_payouts sorted by priority (high → low)
2. Batch up to MaxBatchSize payouts
3. Verify treasury has sufficient balance
4. Call oracle: BatchTransferSOL(transfers[])
5. Receive txHash from Solana
6. Update batch_payout → completed
7. Update provider_earnings → paid + tx_hash
8. Update pending_payouts → remove from queue
On failure:
  - Increment attempts counter
  - Set scheduled_for = now + backoff
  - Status: failed (retry on next cycle)
```

Gas savings (10 payouts):
```
Single: 10 * 5000 = 50,000 lamports (~0.00005 SOL)
Batch:  10 * 3500 = 35,000 lamports (~0.000035 SOL)
Savings: 30% per batch run
```

---

## 9. Transaction System

### 9.1 Transaction Types

| Type | Direction | Trigger |
|---|---|---|
| `topup` | Credit | Consumer deposits SOL to treasury |
| `usage` | Debit | Session bandwidth consumed |
| `earning` | Credit | Session completed (provider side) |
| `payout` | Debit | Batch payout executed |
| `refund` | Credit | Dispute resolved for buyer |

### 9.2 Ledger Entry Model

```go
type WalletLedgerEntry struct {
    ID           UUID
    WalletID     UUID
    Amount       float64       // Positive = credit, Negative = debit
    BalanceAfter float64       // Snapshot after this entry
    Type         string
    ReferenceID  string        // Solana tx signature (88 chars)
    TxHash       string
    Description  string
    CreatedAt    time.Time
}
```

All entries are **immutable** — no updates, only inserts.

### 9.3 Deposit Flow

```
User sends SOL to treasury wallet address
→ Blockchain indexer detects transaction
→ Verify: sender = user's linked Solana wallet
→ Verify: amount > minimum deposit threshold
→ POST /wallet/deposit/crypto { tx_hash, chain: "solana" }
→ API verifies on-chain tx (getTransaction RPC)
→ Create WalletLedgerEntry (type: topup, amount: +solAmount)
→ Update wallet.balance_sol += amount
→ Notify user via NATS event
```

### 9.4 Withdrawal Flow

```
POST /wallet/withdraw/sol { recipient_address, amount_sol }
→ Validate: wallet.balance_sol >= amount
→ Check spending limits (daily/weekly/monthly)
→ Call oracle: SendSOL(recipient, amount)
→ Receive Solana txHash
→ Create WalletLedgerEntry (type: payout)
→ Deduct balance_sol
```

---

## 10. Financial System

### 10.1 Wallet System

- **SOL-only** (as of migration 000027, GHS/USDT removed)
- One wallet per user (auto-created on first login)
- `balance_sol` stored as `NUMERIC(20,9)` — 9 decimal precision
- Spending limits: daily, weekly, monthly (0 = unlimited)
- Limits enforced at DB level via constraint checks

### 10.2 Escrow System

**How it works:**
```
1. Buyer creates order (status: pending)
2. Buyer signs Solana tx → funds locked in on-chain PDA
3. Order status: active, escrow status: held
4. Consumer uses bandwidth
5. Milestone thresholds trigger partial releases (optional)
6. Session ends → buyer releases escrow (or auto-releases after 7 days)
7. Oracle confirms → seller receives funds
8. Order status: completed
```

**Dispute flow:**
```
Buyer or seller opens dispute (POST /escrow/:id/dispute)
→ Escrow status: disputed (funds frozen)
→ Both sides submit evidence
→ Admin or arbitrator resolves (POST /escrow/:id/resolve)
→ Resolution: buyer_wins → refund buyer
             seller_wins → release to seller
             split → partial release both ways
```

### 10.3 Treasury System

**Environment thresholds:**

| Env | Min (Alert) | Warning | Target | Reserve |
|---|---|---|---|---|
| devnet | 5 SOL | 10 SOL | 20 SOL | 50 SOL |
| mainnet | 100 SOL (~$20k) | 250 SOL | 500 SOL | 1000 SOL |

**Auto-monitoring:**
```
TreasuryManager runs continuously
→ Check treasury balance every poll interval
→ Below min → emergency alert + topup trigger
→ Below warning → standard topup to target
→ Record all outgoing transfers for velocity monitoring
```

**Reconciliation Service** (runs daily):
- Compare on-chain balance vs DB ledger
- Detect missing/extra entries
- Alert on any discrepancy

**Velocity Monitoring:**
- Track outgoing transfer rate
- Circuit breaker fires if transfer rate exceeds safe threshold
- Prevents runaway payout bugs from draining treasury

### 10.4 Solana Oracle

```
Oracle keypair loaded from: /run/secrets/oracle-keypair.json
Signs all settlement transactions on behalf of the platform

Functions:
  SendSOL(to, amount)           → single transfer
  BatchTransferSOL(transfers[]) → batch transfer (cheaper gas)
  VerifyTransaction(txSig)      → confirm on-chain
  GetTreasuryBalance()          → query treasury SOL balance
```

**Multi-sig Oracle (Phase 1.5 — partially implemented):**
- Config: 3-of-5 threshold for transfers > 1 SOL
- Large transfers require multi-oracle coordination
- Currently falls back to single-sig for all transfers
- Multi-sig coordination logic incomplete

### 10.5 Price Feed

- Sources: CoinGecko + CoinMarketCap with automatic failover
- Cache TTL: 5 minutes
- Fallback: $150/SOL if all sources fail
- Used for: billing calculation, price suggestions, dashboard display
- **Risk:** $150 fallback is far below current SOL price — could miscalculate billing if price feed fails

---

## 11. Frontend

### 11.1 Page Architecture

```
/                        → Marketing / landing page
/dashboard               → Consumer home (usage, sessions, wallet)
  /analytics             → Usage analytics charts
  /monitoring            → Service health
  /wallet                → SOL balance, deposit, withdraw, transactions
  /sessions              → Active proxy sessions
  /proxy                 → Proxy config / credentials
  /nodes                 → (redirects to provider)
  /provider/             → Provider home
    /setup               → Onboarding guide
    /cli                 → CLI download
    /nodes               → Node management
    /earnings            → SOL earnings tracking
    /services            → Listings management
    /health              → Node health monitoring
    /tokens              → CLI token management
  /earnings              → Consumer earnings (referrals?)
/explorer                → Public blockchain explorer
  /blocks                → Solana blocks
  /transactions          → Transaction list
  /wallets/:address      → Wallet detail
  /nodes                 → Network nodes
  /sessions              → Session explorer
  /leaderboard           → Provider rankings
  /analytics             → Network-wide stats
  /search                → Global search
  /map                   → Geographic node map
/marketplace             → Browse listings
  /:id                   → Listing detail + buy flow
/agents                  → AI agents page (unclear purpose)
```

### 11.2 API Client Modules

All in `apps/web/src/lib/api/`:

| Module | Responsibility |
|---|---|
| `index.ts` | Base fetch wrapper, auth headers, error handling |
| `wallet.ts` | Wallet CRUD, deposit, withdraw, spending limits |
| `marketplace.ts` | Listings CRUD, search, price suggestion |
| `provider.ts` | Nodes, earnings, payout history |
| `explorer.ts` (services/) | Chain blocks, txs, node stats |

### 11.3 State Management

- **TanStack Query** (React Query) for all server state
- Automatic cache, background refetch, loading/error states
- QueryProvider wraps the entire app

### 11.4 Key Components

| Component | Purpose |
|---|---|
| `BuyListingModal.tsx` | Purchase proxy bandwidth from listing |
| `StreamingSessionCard.tsx` | Real-time session stats with terminate button |
| `Sidebar.tsx` | Navigation with user dropdown |
| `ProviderSetupGuide.tsx` | Step-by-step provider onboarding |

---

## 12. Infrastructure & DevOps

### 12.1 Services

| Service | Port | Technology |
|---|---|---|
| control-api | 8080 | Go/Gin |
| edge-gateway | 8080 (proxy), 8090 (mgmt) | Rust |
| web | 3000 | Next.js |
| postgres | 5432 | PostgreSQL |
| redis | 6379 | Redis |
| nats | 4222, 8222 | NATS message bus |
| prometheus | 9091 | Metrics collection |
| grafana | 3001 | Metrics dashboard |
| admin | 3002 | Admin panel |
| redis-exporter | 9121 | Redis → Prometheus |

### 12.2 Service Dependencies

```
web → control-api (HTTP proxy)
control-api → postgres, redis, nats, supabase, solana
edge-gateway → control-api, redis
control-api → edge-gateway (registry updates)
```

### 12.3 Health Checks

- All critical services have Docker healthchecks
- `web` depends on `control-api: condition: service_healthy`
- `control-api` depends on `postgres: condition: service_healthy` + `redis: service_healthy`
- Known issue: startup race on first boot causes transient ECONNREFUSED (resolves once control-api passes health check)

### 12.4 CI/CD

- GitHub Actions workflow: `.github/workflows/ci.yml`
- Tests: Go unit tests (concurrency, orders, wallet, smart matching)

---

## 13. What Is Missing / Incomplete

These are features that have placeholder code, fields, or stubs but no working implementation:

### 13.1 Multi-Sig Oracle Coordination ⚠️ CRITICAL

**Location:** `services/control-api/internal/solana/client.go`

The multi-sig config is loaded on startup and large transfers (>1 SOL) are supposed to require 3-of-5 oracle signatures. However, the coordination logic (gathering signatures from other oracle instances, combining them, broadcasting) is not implemented. **All transfers currently use single-sig fallback regardless of amount.** This is a significant security gap — a compromised single oracle key gives full access to treasury.

### 13.2 ZK Proof Verification ⚠️ CRITICAL

**Location:** `services/control-api/internal/api/zk_reputation.go`, `trustless.go`

`escrow_milestones.verification_proof` field exists but the verification logic is not wired in. Milestone releases can happen without cryptographic proof of bandwidth delivery. The on-chain "trustless" settlement claim is not backed by actual ZK proof verification.

### 13.3 Provider Token Hashing ⚠️ HIGH

**Location:** `services/control-api/internal/api/provider_token.go`

Token hashing is described as one-way but the current implementation appears to use simple string manipulation (`"[HASHED]"` suffix), not proper cryptographic hashing (bcrypt/Argon2). Provider tokens stored this way could be reversed or brute-forced.

### 13.4 Admin Manual Payout API

**Location:** `services/control-api/internal/api/admin_payouts.go`

Route exists (`POST /admin/payouts/manual`), handler file exists, but the actual manual trigger logic is incomplete/stubbed.

### 13.5 Swap Module

**Location:** `services/control-api/internal/api/swap.go`

File exists but is essentially empty (1 line). It was used for multi-currency swaps. Now that SOL-only is enforced, this file should either be properly removed or repurposed. Currently it creates dead routes.

### 13.6 Governance Worker Cleanup

**Location:** `services/control-api/internal/api/governance.go`

`ScheduleProposalWorker()` is called in `main.go` but has no shutdown/cleanup mechanism. This could leak goroutines on application restart.

### 13.7 Agents Feature — Backend Exists But Unclear Purpose

**Location:** `apps/web/src/app/agents/page.tsx`, `services/control-api/internal/api/agents.go`, `agent_registry.go`

An agent registry and agent API do exist in the backend (with tests: `agents_test.go`). However, the purpose of "AI agents" in the context of a proxy marketplace is undocumented. It likely refers to automated proxy consumers (bots/scrapers as first-class agents), but this is not clear from the codebase structure alone.

### 13.8 Explorer WebSocket

**Location:** `services/control-api/internal/api/explorer_ws.go`

WebSocket handler for real-time explorer updates exists, but the `useExplorerWS.ts` hook suggests the frontend connection may be incomplete.

### 13.9 Price Feed Fallback Risk

**Location:** `services/control-api/internal/billing/price.go`

Fallback SOL price is `$150`. Current market price is ~$130–200. If price feed goes down and SOL is trading at $200+, consumers are billed less than the actual cost. This is a direct revenue leak.

---

## 14. What Is Unhealthy / At Risk

### 14.1 Single Oracle Keypair = Single Point of Failure 🔴

All SOL transfers — deposits, withdrawals, batch payouts, escrow releases — are signed by a single oracle keypair. If this key is:
- Lost → platform cannot process any payments
- Compromised → entire treasury can be drained

**Risk: CRITICAL**. Multi-sig is designed but not implemented.

### 14.2 Startup Race Condition 🟡

As demonstrated live: `control-api` retries DB connection on startup, but if `web` starts before `control-api` is healthy, it floods logs with ECONNREFUSED errors. The `depends_on: service_healthy` is set, but the web app's internal polling (notification unread count, analytics) begins immediately on page load, before the user even navigates anywhere.

**Risk: LOW** (cosmetic/operational). Does not affect functionality once system is up.

### 14.3 Session Credential Encryption Migration 🟡

One-time migration: `MIGRATE_CREDENTIALS=true` must be run to encrypt old plaintext credentials. If this was never run in production, old sessions have plaintext credentials in the database.

**Risk: HIGH** if production has sessions created before encryption was added.

### 14.4 Admin Account Hardcoding 🟡

Only 3 admin accounts, defined via environment variables. No admin creation UI, no password rotation mechanism, no MFA. A compromised admin env var gives full platform admin access with no audit trail of who used it.

**Risk: MEDIUM** (operational security).

### 14.5 Redis Single Instance — No Persistence Guarantee 🟡

Redis holds real-time bandwidth metering (`billing:session:*:pending`). If Redis crashes between metering and hourly settlement:
- In-flight bandwidth usage is **lost**
- Consumers get free bandwidth for that period
- Provider earnings for that period are **lost**

**Risk: MEDIUM**. Redis AOF persistence is not explicitly enabled in docker-compose.

### 14.6 Reconciliation Alerts — No Escalation Path 🟡

The reconciliation service detects discrepancies but the alerting mechanism is logging-only. There's no PagerDuty/Slack/email integration to escalate financial discrepancies to a human in real time.

**Risk: MEDIUM** (operational).

### 14.7 Price Feed $150 Fallback 🟠

If CoinGecko + CoinMarketCap both fail and SOL is trading at $200, consumers get billed ~25% less than actual cost. For high-volume usage, this could be meaningful revenue loss.

**Risk: LOW-MEDIUM**. Unlikely both feeds fail simultaneously, but the fallback value should be updated regularly or use a 24h TWAP backup.

### 14.8 NATS — No Dead Letter Queue 🟡

NATS is used for async events but there's no evidence of dead-letter queues or message replay for failed deliveries. Lost events = lost billing or notification.

**Risk: MEDIUM** (data integrity).

---

## 15. What Is Confusing / Ambiguous

### 15.1 Dual Session Creation Paths

There are three endpoints for creating a session:
- `POST /sessions` — generic creation
- `POST /sessions/instant` — no config needed
- `POST /sessions/from-listing` — provider-specific

It's unclear:
- What exactly is different between `/sessions` and `/sessions/instant`
- Whether `/sessions/from-listing` creates an order + escrow OR just a session
- What happens to billing if a session is created without an associated order

### 15.2 Wallet Balance vs Order Escrow

The system has two financial mechanisms:
1. **Internal wallet balance** (balance_sol in DB)
2. **On-chain escrow** (Solana PDA via orders)

It's unclear when each is used. Are sessions always backed by escrow? Or is the wallet balance a prepaid credit system independent of on-chain escrow? The `POST /sessions` endpoint deducts from wallet balance, but `POST /orders/:id/pay/solana` locks funds on-chain. These two paths appear to coexist without a clear decision tree for when to use each.

### 15.3 Provider Earnings vs Wallet Balance

Providers have:
1. `provider_earnings` records (pending → paid status)
2. `wallet.balance_sol` (for their own wallet)

It's unclear whether provider earnings are reflected in wallet balance before payout, or only credited to the wallet ledger after the Solana batch payout happens. If earnings are only in the DB until batch payout fires, the provider's dashboard wallet balance won't show pending earnings.

### 15.4 "Agents" Page in Frontend

`apps/web/src/app/agents/page.tsx` exists but there is no `/agents` in the API and no documentation. Appears to be a placeholder for a future AI-agent marketplace feature with no backend yet.

### 15.5 Social DB Split (Supabase vs Primary)

Auth and social features (forum, messaging, friends, circles) live in Supabase. Business data (sessions, orders, wallets) lives in the primary PostgreSQL. This split means cross-table JOINs are impossible — fetching "sessions for forum user X" requires two separate database calls. There's no clear documentation on what lives where and why.

### 15.6 `explorer_transactions` vs `wallet_ledger_entries`

Both track "transactions" but serve different purposes:
- `explorer_transactions` = indexed Solana on-chain transactions
- `wallet_ledger_entries` = internal DB accounting records

These should be reconciled but may not always match (indexer lag, on-chain transactions not yet indexed, etc.). The relationship between these two tables is not formalized.

### 15.7 `orders` vs `sessions` — When to Use Which

An order is an escrow-based bandwidth purchase tied to a specific listing. A session is a proxy credential/routing record. Can a session exist without an order? Can an order exist without a session? The lifecycle relationship is not clearly documented in code.

### 15.8 KYC Removal — Dangling References

`models/kyc.go` and `api/kyc.go` were deleted (visible in git status). If any other files referenced KYC types, those references now fail silently or were cleaned up without documentation of the decision.

### 15.9 `swap.go` — Empty File

The swap module file exists but does nothing. Confusing for future developers who might try to understand what swapping means in this system.

---

## 16. System Rating

| Dimension | Score | Notes |
|---|---|---|
| **Architecture Design** | 8/10 | Well-structured service separation, clean domain modeling, good use of Rust for gateway |
| **Financial System** | 7/10 | Solid batch payout, escrow, ledger; single oracle keypair is a major gap |
| **Security** | 5/10 | Encrypted credentials + rate limiting are good; single oracle key, weak admin auth, incomplete multi-sig are serious concerns |
| **API Design** | 7/10 | RESTful, well-organized; some ambiguous session/order split |
| **Database Design** | 8/10 | Good normalization, soft deletes, partitioning, materialized views |
| **Gateway / Proxy** | 8/10 | Rust gateway is production-quality; Yamux tunneling is solid |
| **Billing Accuracy** | 6/10 | Redis metering is good but no AOF persistence; $150 fallback is stale |
| **Frontend UX** | 6/10 | Functional but unclear separation between provider/consumer flows; agents page adds confusion |
| **Observability** | 7/10 | OpenTelemetry + Prometheus + Grafana is solid; reconciliation alerts need escalation |
| **Code Completeness** | 6/10 | Several critical stubs (multi-sig, ZK proofs, admin payouts, token hashing) |
| **Documentation** | 4/10 | Many .md analysis files in root but no inline API docs, no OpenAPI spec |

**Overall System Score: 6.5 / 10**

---

## 17. Pros & Cons

### Pros

1. **Solid core architecture** — Separation of concerns is good. Go for business logic, Rust for performance-critical proxy, React for frontend, Solana for settlement.

2. **Real blockchain integration** — Not just a wrapper. On-chain escrow PDAs, oracle-signed settlements, blockchain indexer — genuine on-chain activity.

3. **Quality-based earnings multiplier** — Smart incentive design. Providers who run reliable, fast nodes earn more. Creates natural quality improvement pressure.

4. **Batch payout optimization** — 30% gas savings vs per-transaction payouts. Shows cost awareness in blockchain system design.

5. **Comprehensive financial controls** — Spending limits, wallet check constraints, reconciliation, velocity monitoring, treasury auto-topup. Shows mature financial thinking.

6. **Yamux tunneling in Rust gateway** — Connection multiplexing gives efficient use of provider connections without per-request TCP overhead.

7. **Soft deletes everywhere** — Audit trail maintained. No data permanently lost on delete.

8. **Multi-source price feeds** — CoinGecko + CoinMarketCap fallback is resilient.

9. **Circuit breakers at multiple layers** — Both Go and Rust services have circuit breakers preventing cascading failures.

10. **Full-text search on marketplace** — GIN index + FTS makes marketplace browsing fast at scale.

### Cons

1. **Single oracle keypair** — The most serious architectural weakness. One key controls all on-chain treasury operations. A compromised key = total fund loss.

2. **ZK proofs not actually verified** — The "trustless" settlement claim in marketing/docs is technically incorrect until the ZK proof verification is wired in. Currently settlement is trust-based on bandwidth reports.

3. **Provider token hashing incomplete** — CLI auth tokens should use Argon2/bcrypt, not string manipulation. Stored tokens could be reversed.

4. **Redis metering without persistence** — Real-time bandwidth billing lives in Redis with no persistence guarantee. A Redis crash between metering and settlement loses revenue from both sides.

5. **Ambiguous session/order model** — Two overlapping financial paths (wallet balance deduction vs on-chain escrow) without clear decision criteria creates confusion and potential billing inconsistencies.

6. **Admin system is primitive** — 3 hardcoded accounts in env vars with no rotation, no MFA, no audit trail per-account. Single shared admin JWT secret.

7. **Stale fallback price** — $150/SOL fallback is a fixed value that will drift significantly from actual SOL price, causing billing errors during price feed outages.

8. **No OpenAPI spec** — 60+ endpoints with no auto-generated documentation. Difficult for frontend/partner integration.

9. **Social DB split adds complexity** — Supabase for social, PostgreSQL for business data. No clear boundary documentation. Cross-entity queries require multi-DB round trips.

10. **Dead code accumulation** — `swap.go` (empty), KYC files deleted without cleaning up all references, `agents` page with no backend. Technical debt accumulating.

---

## 18. Priority Fix & Improvement Roadmap

### P0 — Security Critical (Fix Immediately)

| # | Issue | Action |
|---|---|---|
| P0.1 | Single oracle keypair | Implement multi-sig oracle coordination OR use a hardware wallet / Solana multi-sig program before mainnet. At minimum, add key rotation procedure. |
| P0.2 | Provider token hashing | Replace current implementation with Argon2id hashing. Rotate all existing tokens. |
| P0.3 | Session credential migration | Verify `MIGRATE_CREDENTIALS=true` was run on production. If not, encrypt all plaintext credentials now. |

### P1 — Financial Integrity (Fix Before Scale)

| # | Issue | Action |
|---|---|---|
| P1.1 | Redis persistence for metering | Enable Redis AOF persistence (`appendonly yes`) to prevent billing loss on Redis crash. |
| P1.2 | Price feed fallback | Change fallback to a 24-hour TWAP sourced from an on-chain Pyth/Switchboard oracle rather than a hardcoded value. |
| P1.3 | ZK proof verification | Either wire in actual ZK proof verification for escrow milestone releases, OR remove the `verification_proof` field and update marketing to reflect trust-based settlement. |
| P1.4 | NATS dead letter queue | Add dead letter handling for billing and payout events to prevent silent message loss. |

### P2 — Architecture Cleanup (Fix for Developer Sanity)

| # | Issue | Action |
|---|---|---|
| P2.1 | Clarify session vs order model | Document and enforce: sessions are always created from orders. Remove ambiguous dual-path. |
| P2.2 | Provider earnings → wallet balance | Make pending earnings visible in wallet balance (as "pending" balance) so provider dashboard is accurate. |
| P2.3 | Remove `swap.go` | Delete the empty swap module. If future swap feature is planned, add a clear TODO with design notes. |
| P2.4 | Remove or implement `agents` page | Either build the backend for it or remove the orphaned frontend page. |
| P2.5 | Document DB split boundary | Add a `DATABASE_ARCHITECTURE.md` that clearly states what lives in Postgres vs Supabase and why. |

### P3 — Observability & Operations

| # | Issue | Action |
|---|---|---|
| P3.1 | Reconciliation alerts | Add Slack/PagerDuty webhook for financial discrepancy alerts. |
| P3.2 | Admin account improvements | Add admin account management with proper per-account audit trail. At minimum add MFA support. |
| P3.3 | Expose OpenAPI spec | `docs/docs.go` exists (swaggo-generated) but it's unclear if the `/swagger` endpoint is enabled and accessible in production. Verify and expose it publicly. |
| P3.4 | Governance worker cleanup | Add proper context cancellation and goroutine cleanup for `ScheduleProposalWorker`. |

### P4 — Product Improvements

| # | Issue | Action |
|---|---|---|
| P4.1 | Trust tier auto-promotion | Add automated tier promotion (new → verified) based on usage history/KYC-lite checks. |
| P4.2 | Real-time earnings dashboard | Show provider earnings in real time (WebSocket push from settlement events). |
| P4.3 | Consumer billing preview | Show estimated cost before session creation based on target bandwidth + current SOL price. |
| P4.4 | Node health auto-remove | If a node's quality score drops below 40 for 24h, auto-suspend listing. Currently requires manual intervention. |
| P4.5 | CLI self-update mechanism | The update mechanism exists but needs to be tested and documented with checksum verification. |

---

*Report generated by automated codebase analysis. All findings are based on source code examination and should be validated against current production state before acting on security recommendations.*
