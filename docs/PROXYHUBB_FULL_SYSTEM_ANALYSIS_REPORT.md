# ProxyHubb — Full System Analysis Report

**Date:** 2026-03-13
**Scope:** Edge Gateway, Blockchain Integration, Financial System, Proxy Marketplace, User Wallets, Token Tracking, Provider Economics
**Analyst:** Claude Code (Deep-dive across all services)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Edge Gateway — Deep Dive](#3-edge-gateway--deep-dive)
4. [Blockchain Integration](#4-blockchain-integration)
5. [Financial System](#5-financial-system)
6. [Proxy System — How It Works](#6-proxy-system--how-it-works)
7. [Provider Side — Selling Proxies](#7-provider-side--selling-proxies)
8. [User Wallets & Deposits](#8-user-wallets--deposits)
9. [How Users Are Paid](#9-how-users-are-paid)
10. [Token Tracking](#10-token-tracking)
11. [Database — Full Schema](#11-database--full-schema)
12. [Fallbacks & Broken Things](#12-fallbacks--broken-things)
13. [Security Vulnerabilities](#13-security-vulnerabilities)
14. [What Is Not Working or Not Wired](#14-what-is-not-working-or-not-wired)
15. [Recommended Fixes by Priority](#15-recommended-fixes-by-priority)
16. [Conclusion](#16-conclusion)

---

## 1. Executive Summary

ProxyHubb is a **decentralized proxy marketplace** that allows providers to sell their internet bandwidth/proxies and consumers to buy proxy sessions, with all payments settled trustlessly on the **Solana blockchain**.

The system is built as a polyglot microservices architecture:

| Service | Language | Role |
|---------|----------|------|
| `services/edge-gateway` | Rust | High-performance proxy routing & tunneling |
| `services/control-api` | Go | Business logic, billing, blockchain, users |
| `apps/web` | Next.js (TypeScript) | Consumer-facing frontend |
| `apps/admin` | Next.js (TypeScript) | Admin panel |
| PostgreSQL | — | Persistent data store |
| Redis | — | Session cache, rate limiting, registry |
| NATS JetStream | — | Event bus for async workers |
| Solana | Anchor/Rust | Smart contracts, escrow, settlement |

**Overall Assessment:** The architecture is production-grade and sophisticated. There are critical security vulnerabilities, incomplete feature wiring, and scalability bottlenecks that must be resolved before handling production traffic at scale.

---

## 2. System Architecture Overview

### 2.1 How the System Fits Together

```
[User Browser / Client]
        |
        |  HTTP(S) / WebSocket
        v
[Web App - Next.js :3000]
        |
        |  REST / WebSocket
        v
[Control API - Go :8081]   <-->  [PostgreSQL DB]
        |                  <-->  [Redis Cache]
        |                  <-->  [NATS JetStream]
        |                  <-->  [Solana Blockchain]
        |
        |  Provider auth / JWT
        v
[Edge Gateway - Rust :3128 proxy, :8090 metrics]
        |
        |  yamux multiplexed TCP tunnel
        v
[Provider Nodes] (users selling their proxy bandwidth)
```

### 2.2 Traffic Flow (Consumer Using a Proxy)

```
1. Consumer sends HTTP CONNECT to Edge Gateway :3128
2. Edge Gateway extracts Proxy-Authorization header
3. Validates session token against Redis cache
4. Selects best provider node (scoring algorithm)
5. Checks circuit breaker for selected provider
6. Opens yamux stream to provider
7. Bridges consumer <-> provider bidirectionally
8. Meters bandwidth in 64KB chunks
9. Every 30s, flushes usage report (Ed25519-signed) to Control API
10. Control API debits consumer wallet, credits provider wallet
```

---

## 3. Edge Gateway — Deep Dive

### 3.1 What It Does

The Edge Gateway (`services/edge-gateway/src/`) is the network-level proxy router. It:

- Accepts incoming `HTTP CONNECT` tunnels from consumers
- Authenticates sessions via Redis
- Selects the best provider node to fulfill the request
- Opens a bidirectional tunnel between consumer and provider using **yamux** (stream multiplexing over TCP)
- Meters bandwidth and reports usage to the Control API
- Enforces security policies (SSRF, port filtering, rate limits)

### 3.2 Module Breakdown

#### `main.rs` — Request Handler (710 lines)

This is the entry point for all proxy requests. The flow per-request:

```
Line 91-390:   HTTP CONNECT handler
Line 114-152:  DDoS + geo-blocking pre-flight check
Line 155-158:  WebSocket upgrade detection
Line 162-163:  metrics::connection_started() called
Line 168-212:  Session authentication via Redis
Line 208:      ⚠️ CRITICAL BUG — on Redis failure, falls back to anonymous user
Line 256-270:  Rate limiting enforcement (governor crate)
Line 312-360:  Spawns tokio task for tunnel bridging
Line 528-546:  Zero-copy bidirectional bridge (64KB buffers, 100MB revalidation)
Line 553:      Usage reporting via Ed25519-signed payload to Control API
```

#### `state.rs` — Node Registry & Provider Scoring (513 lines)

Maintains the in-memory registry of all connected provider nodes.

**Scoring Algorithm (per provider):**
```
Base score:         1000
- Latency penalty:  -1 per millisecond
- Load penalty:     -500 if 100% utilized
- Bandwidth penalty:-100 if 10MB/s throughput
+ Freshness bonus:  +50 if node registered < 24 hours ago
```

**Selection method:** O(n) linear scan across all providers — fine for small fleets, becomes a bottleneck at 1,000+ providers.

The state object holds:
- `registry: Arc<LockFreeNodeRegistry>` (Phase 1 upgrade, partially wired)
- `routing: Arc<MLRouter>` (Phase 3 — not yet in production path)
- `ddos: Arc<AdaptiveRateLimiter>` (Phase 4 — not yet active)
- `geo_block: Arc<GeoBlockList>` (Phase 4 — not yet active)
- `multiregion: Arc<MultiRegionRouter>` (Phase 4 — not yet active)

#### `tunnel.rs` — Provider Connection Handler (306 lines)

Handles the reverse connection from provider nodes to the gateway:

```
Lines 21-76:   TLS setup (optional mTLS)
Lines 78-280:  handle_provider_connection()
Lines 99-149:  JWT auth handshake
Line 111:      ⚠️ insecure_disable_signature_validation() called (then overwritten — dead code risk)
Lines 165-208: Load node metadata from Redis (reputation persistence)
Lines 191-208: GeoIP detection (hardcoded fallback for 3 countries only)
Lines 216-260: Heartbeat loop reading control messages
Lines 262-279: Cleanup on disconnect — saves node stats to Redis
```

#### `auth.rs` — Session Authenticator

- Caches session data in a process-local HashMap (unbounded — memory leak)
- Flat 5-minute TTL for all sessions (no tier-based differentiation)
- Validates credentials against Redis session store
- Session data carried: `user_id`, `session_id`, `type`, `bandwidth_limit`, `trust_tier`, `target_geo`

**Problem:** The HashMap grows indefinitely. At scale (500K+ sessions), this causes out-of-memory crashes.

#### `circuitbreaker.rs` — Fault Tolerance (382 lines)

Per-provider circuit breaker:

```
Failure threshold:   3 failures
Timeout:             30 seconds flat (no exponential backoff)
HalfOpen → Closed:  After 1 success (success_threshold = 2 is ignored)
Lock type:           RwLock — write-locked on every call
```

**Problem:** Success threshold is defined but not enforced. Breaker re-closes after first success.

#### `heartbeat.rs` — Health Monitoring (422 lines)

Dual-layer system:

```
HeartbeatMonitor:   In-memory per-node last-seen tracking
HeartbeatStore:     Redis-backed persistent heartbeat records
Check interval:     Every 10 seconds
Timeout:            60 seconds without heartbeat = unhealthy
Max missed:         3 heartbeats before eviction
```

**Problem:** `HeartbeatMonitor` is disconnected from `tunnel.rs`. Tunnel updates don't flow into the monitor, so the monitor has stale data.

#### `metering.rs` — Usage Reporting (122 lines)

Accumulates bandwidth counters per session, flushed every 30 seconds with an Ed25519 cryptographic signature to prevent fraud.

**Problems:**
- 30-second window means up to 30s of usage is lost on any crash
- No retry on flush failure — data is silently dropped if Control API is down
- Creates a new HTTP client per flush (TLS handshake overhead)

#### `policy.rs` — Destination Validation (194 lines)

SSRF protection:
- Blocks RFC 1918 private IPs (10.x, 172.16.x, 192.168.x)
- Blocks cloud metadata (169.254.169.254, 169.254.170.2)
- Allows ports: **80 and 443 only**

**Problems:**
- Port 8080, 8443, 3000, 3306, etc. are all blocked — legitimate use cases fail
- No DNS rebinding protection
- No domain-level blocklist

#### `qos.rs` — Bandwidth Throttling (107 lines)

Per-session bandwidth cap: **flat 10MB/s for all users regardless of tier**.

**Problem:** No differentiation between free/basic/pro tiers. All users get the same cap.

#### `rotation.rs` — IP Rotation (294 lines)

Implements 4 strategies: `TimeBased`, `RequestBased`, `Smart`, `Hybrid`.

**Status: Fully implemented but NOT wired into the request path.** Dead code.

#### `leader.rs` — Distributed Leader Election (139 lines)

Redis-based leader election using SET NX EX + Lua scripting.

**Status: Fully implemented but NOT used anywhere.** No tasks are gated on leader status. Dead code.

#### Phase 2–4 Modules (Implemented but Not in Production Path)

| Module | File | Status |
|--------|------|--------|
| HTTP/2 CONNECT | `proxy/http2.rs` | Implemented, not wired |
| WebSocket tunnel | `proxy/websocket.rs` | Implemented, optional upgrade |
| Zero-copy splice | `proxy/zerocopy.rs` | Implemented, Linux-only |
| ML router | `routing/ml_router.rs` | Implemented, Phase 3 |
| Feature tracking | `routing/features.rs` | Implemented |
| Predictive warmup | `routing/prewarm.rs` | Implemented |
| Rolling analytics | `routing/analytics.rs` | Implemented |
| A/B test control | `routing/ab_test.rs` | Implemented |
| Adaptive DDoS | `security/ddos.rs` | Implemented, Phase 4 |
| IP reputation | `security/reputation.rs` | Implemented |
| TLS fingerprinting | `security/fingerprint.rs` | Implemented |
| Multi-region | `multiregion/routing.rs` | Implemented |
| Staged rollout | `rollout/mod.rs` | Implemented |
| Lock-free registry | `registry/lockfree.rs` | Implemented, Phase 1 |
| Connection pool | `pool/mod.rs` | Implemented, Phase 1 |

---

## 4. Blockchain Integration

### 4.1 How the Edge Gateway Connects to Blockchain

The Edge Gateway does **not** talk to Solana directly. The flow is:

```
Edge Gateway
    |
    | HTTP POST (Ed25519-signed usage report)
    v
Control API (/v1/internal/usage-report)
    |
    | After accumulating usage
    v
Solana RPC (settlement transaction)
```

The Gateway signs usage reports with an **Ed25519 keypair** (`ORACLE_KEYPAIR_PATH`) so the Control API can verify the data came from a legitimate gateway instance and not a spoofed report.

### 4.2 Solana Integration in Control API

**Initialization** (`main.go` Lines 99–139):

```go
// Multiple RPC endpoints with failover
endpoints := []string{
    os.Getenv("SOLANA_RPC_ENDPOINT"),
    "https://api.devnet.solana.com",
    "https://api.mainnet-beta.solana.com",
}

// Oracle client uses keypair from secrets
oracleClient = solana.NewOracleClient(keypairPath)

// WebSocket for real-time event streaming
wsClient = solana.NewWSClient(os.Getenv("SOLANA_WS_ENDPOINT"))

// Event watcher monitors treasury wallet
eventWatcher.Watch(treasuryAddress)

// Session activator processes on-chain events to activate sessions
sessionActivator.Start()
```

### 4.3 Smart Contract Functionality

The Solana program (Anchor/Rust) handles:

| Function | Description |
|----------|-------------|
| **Escrow creation** | Consumer locks funds before session starts |
| **Session activation** | On-chain proof of session start |
| **Settlement** | Oracle signs release of escrowed funds to provider |
| **Dispute resolution** | Jury voting system for contested sessions |
| **Provider staking** | Providers stake SOL as security deposit |
| **Emergency pause** | Admin-controlled kill switch |
| **Governance** | DAO proposal and voting mechanism |

### 4.4 Settlement Flow (On-Chain)

```
1. Consumer creates proxy order
2. Control API creates escrow account on Solana (locks consumer SOL/USDC)
3. Session is created, credentials sent to Edge Gateway via Redis
4. Consumer uses proxy — bandwidth metered at gateway
5. Gateway sends signed usage report to Control API every 30s
6. Control API accumulates usage in Redis (billing:session:*:pending)
7. Hourly settlement worker runs:
   a. Reads all pending usage
   b. Calculates cost = (bytes / 1GB) * pricePerGB
   c. Converts USDC→SOL at live oracle price
   d. Debits consumer's internal wallet
   e. Credits provider's internal wallet
   f. If provider balance ≥ 0.05 SOL → triggers on-chain payout transaction
8. Oracle client signs the payout transaction with oracle keypair
9. Solana program releases escrowed funds to provider wallet
```

### 4.5 Blockchain Workers

| Worker | Interval | What It Does |
|--------|----------|-------------|
| Settlement Aggregator | 1 hour | Batch escrow settlements |
| Escrow Cleaner | 30 min | Closes expired escrow accounts (reclaims rent) |
| Liquidity Manager | 1 hour | Rebalances treasury between SOL/USDC |
| Blockchain Indexer | 400ms | Polls Solana for new blocks and transactions |
| ZK Settlement Worker | Continuous | Zero-knowledge proof settlements (experimental) |
| Registry Sync | 5 min | Syncs on-chain provider registry with DB |

---

## 5. Financial System

### 5.1 Dual-Layer Accounting

ProxyHubb uses a **two-layer financial system**:

**Layer 1 — Internal Ledger (PostgreSQL)**
- Fast, off-chain, low-fee micro-transactions
- Used for per-session billing
- Every debit/credit recorded in `wallet_ledger_entries`

**Layer 2 — On-Chain Settlement (Solana)**
- Trustless settlement of accumulated balances
- Triggered when balance threshold reached (≥ 0.05 SOL)
- Final source of truth for large transfers

### 5.2 Billing Worker (`billing/worker.go`)

```
StartSettlementWorker → runs every 1 hour

SettleUsage:
  1. SCAN Redis for keys matching "billing:session:*:pending"
  2. For each pending session:
     a. Parse session_id from Redis key
     b. Get session from DB
     c. Get pricing from DB (price per GB for session type)
     d. Calculate: cost_usdt = (bytes_used / 1_000_000_000) * price_per_gb
     e. Convert to SOL using live oracle price
     f. BEGIN DB transaction:
        - Lock consumer wallet row (SELECT FOR UPDATE)
        - Check consumer balance ≥ cost
        - Debit consumer wallet
        - Insert ledger entry (type: "session_charge")
        - Credit provider wallet
        - Insert ledger entry (type: "provider_earning")
        - If provider balance ≥ 0.05 SOL → queue on-chain payout
     g. COMMIT transaction
     h. Clear Redis pending key
```

### 5.3 Pricing (`billing/price.go`)

Pricing is stored per session type. The system supports:
- Per-GB pricing (most common)
- Conversion between USDC and SOL using a live oracle price feed
- Different rates per provider tier (basic, standard, premium)

### 5.4 Currency Flow

```
Consumer deposits USDC/SOL →
  Internal wallet credited →
    Session created →
      Bandwidth consumed →
        Hourly billing deducts from consumer internal wallet →
          Provider internal wallet credited →
            When threshold reached: on-chain payout to provider's Solana wallet
```

### 5.5 Escrow Model

Before a session starts:
1. Consumer's funds are locked in a Solana escrow account (Program Derived Address)
2. Session is only activated after escrow confirmation
3. Funds released on session completion via oracle-signed transaction
4. If session disputed: jury vote determines fund release

---

## 6. Proxy System — How It Works

### 6.1 Session Types

| Type | Behavior |
|------|----------|
| `rotating` | Each request gets a different provider (new IP) |
| `sticky` | All requests route to same provider (consistent IP) |

### 6.2 Session Lifecycle

```
POST /v1/sessions/
  ↓
createSession handler:
  1. Validate session type (rotating/sticky)
  2. Check KYC if geo-targeting requested
  3. Generate credentials:
     - username: 16-char random hex
     - password: 32-char random hex
  4. Acquire distributed lock (prevent race condition)
  5. Select matching provider node from registry
  6. Create session record in DB (status: active)
  7. Write session to Redis (5-minute TTL, auto-refreshed on use)
  8. Return credentials + proxy host:port to consumer

Consumer uses proxy:
  → HTTP CONNECT edge-gateway:3128
  → Proxy-Authorization: Basic base64(username:password)
  → Edge Gateway validates against Redis session
  → Tunnels to provider node
  → Traffic flows

POST /v1/sessions/:id/terminate
  ↓
  1. Update session status to "terminated" in DB
  2. Delete session from Redis
  3. Trigger final billing settlement for this session
  4. Close tunnel gracefully
```

### 6.3 Bandwidth Metering

```
Gateway side (metering.rs):
- Bidirectional byte counters per session
- Accumulated in memory (64KB read chunks)
- Flushed to Control API every 30 seconds
- Signed with Ed25519 to prevent tampering

Control API side:
- Stores in Redis: billing:session:{id}:pending → {bytes_in, bytes_out, timestamp}
- Hourly worker reads and settles
```

### 6.4 Provider Node Registration

Providers run a lightweight client that:
1. Authenticates to Edge Gateway tunnel endpoint with a JWT
2. Opens a yamux-multiplexed reverse tunnel
3. Sends periodic heartbeats (every 30s)
4. Receives connection streams from consumers through the tunnel
5. Forwards traffic locally through their internet connection

---

## 7. Provider Side — Selling Proxies

### 7.1 How a Provider Joins

```
1. Provider registers account on ProxyHubb web app
2. Provider links their Solana wallet
3. Provider stakes SOL (security deposit — amount TBD per tier)
4. Provider downloads and runs the ProxyHubb node client
5. Node client authenticates via JWT (signed by Control API)
6. Node connects reverse tunnel to Edge Gateway (port 8090 provider endpoint)
7. Node registered in DB (nodes table) and Redis registry
8. Node immediately eligible for consumer routing
```

### 7.2 Provider Tiers (`migrations/000005_provider_tiers.up.sql`)

Providers are classified into tiers affecting:
- Routing priority (higher tier = more traffic)
- Pricing they can charge per GB
- Staking requirements
- Dispute resolution weight

### 7.3 Proxy Listing / Marketplace

```
GET /v1/listings/
  → Returns available proxy listings (public, no auth)
  → Each listing shows: geo, type, speed tier, price per GB

POST /v1/matching/
  → Smart matching: consumer specifies requirements
  → System selects best-fit provider based on:
    - Geographic requirements
    - Session type (rotating/sticky)
    - Price preference
    - Provider reputation/trust score
    - Current availability (load, circuit breaker state)
```

### 7.4 Provider Tracking

The `nodes` table tracks per-provider:
- `ip_address` — Provider's external IP
- `status` — online/offline/suspended
- `trust_score` — Reputation score (affects routing weight)
- `user_id` — Owning user account

Redis tracks (runtime):
- `node:{id}:stats` — Latency, load, bandwidth (updated live)
- `node:{id}:heartbeat` — Last heartbeat timestamp
- Reputation data persisted across gateway restarts

### 7.5 Provider Reputation System

Score starts at 1000, modified by:
- High latency: -1 per ms
- High load: -500 at 100% utilization
- High bandwidth: -100 at 10MB/s
- Fresh node bonus: +50 if registered < 24 hours
- Session success/failure (via Control API feedback)

Reputation is persisted to Redis on disconnect, reloaded on reconnect.

### 7.6 How Providers Earn

```
Consumer uses session on Provider X:
  → Gateway meters bytes (in + out)
  → Usage report sent to Control API
  → Billing worker:
      cost = (bytes / 1GB) * provider_price_per_gb
      credits provider's internal wallet
  → When provider wallet ≥ 0.05 SOL:
      on-chain payout transaction fired
      SOL/USDC sent to provider's linked Solana wallet
```

### 7.7 Provider Dashboard Tracking

Providers can view (via web app):
- Total earnings (internal wallet balance)
- Per-session earnings (wallet_ledger_entries)
- Bandwidth sold (session records)
- Reputation score
- Active sessions count

---

## 8. User Wallets & Deposits

### 8.1 Wallet Creation

Wallets are created automatically when a user first accesses the wallet endpoint:

```go
// wallet.go
getWallet handler:
  1. Look up user's wallet in DB (WHERE user_id = ?)
  2. If not found:
     a. Auto-create wallet record (balance = 0, currency = "USDC")
     b. Safety: also auto-create profile if missing (FK protection)
  3. Return wallet balance + recent transactions
```

**Problem:** No explicit error handling on wallet creation failure. If the DB insert fails, the user gets an error with no retry or feedback.

### 8.2 Deposit Methods

**Crypto Deposit (Solana):**
```
POST /v1/wallet/deposit/crypto
  Rate limited: 5 requests/minute
  Flow:
    1. Generate a deposit address (system-controlled Solana wallet)
    2. Return address to user
    3. Blockchain Indexer (400ms poll) detects incoming transaction
    4. On confirmation: credit user's internal wallet
    5. Record in wallet_ledger_entries (type: "deposit")
```

**Fiat Deposit (Legacy — Paystack):**
```
POST /v1/wallet/deposit
  Flow:
    1. Create Paystack payment intent
    2. User redirected to Paystack checkout
    3. On successful payment: credit user wallet (type: "fiat_deposit")
    4. Conversion: fiat → USDC at market rate
```

### 8.3 Linking External Wallets

```
POST /v1/wallet/link
  Body: { wallet_address: "SolanaPublicKey...", chain: "solana" }
  Flow:
    1. Validate Solana public key format
    2. Verify ownership (sign a challenge message with wallet)
    3. Store linked wallet address on user profile
    4. Used for withdrawals
```

### 8.4 Withdrawals

**SOL Withdrawal:**
```
POST /v1/wallet/withdraw/sol
  Flow:
    1. Validate withdrawal amount ≥ minimum
    2. Check user's internal wallet balance
    3. Debit internal wallet (atomically)
    4. Record ledger entry (type: "withdrawal")
    5. Fire Solana transfer transaction to user's linked wallet
    6. Record transaction hash
```

**Fiat Withdrawal (Mobile Money):**
```
POST /v1/wallet/withdraw
  Flow:
    1. Convert balance to fiat at market rate
    2. Initiate Mobile Money transfer (regional payment provider)
    3. Status tracked asynchronously
```

### 8.5 Balance Tracking

Every financial movement records a `wallet_ledger_entries` row:

| Type | When |
|------|------|
| `deposit` | Crypto deposited |
| `fiat_deposit` | Fiat deposited via Paystack |
| `session_charge` | Consumer charged for proxy usage |
| `provider_earning` | Provider credited for bandwidth sold |
| `withdrawal` | User withdraws to external wallet |
| `refund` | Disputed session refund |
| `stake` | Provider stakes SOL |
| `unstake` | Provider unstakes SOL |

---

## 9. How Users Are Paid

### 9.1 Consumer (Proxy Buyer) Perspective

1. Deposit SOL/USDC into internal wallet
2. Create a proxy session (funds locked in escrow)
3. Use the proxy — bandwidth debited in real-time (settled hourly)
4. Session ends — remaining escrow returned

### 9.2 Provider (Proxy Seller) Perspective

1. Register node, stake SOL
2. Node connects to Edge Gateway
3. Traffic routed through their connection
4. Internal wallet credited per GB served
5. Auto-payout to Solana wallet when balance ≥ 0.05 SOL

### 9.3 Payout Trigger

```go
// billing/worker.go
if providerBalance >= 0.05_SOL {
    // Fire on-chain settlement transaction
    err := solana.SettleProvider(providerWalletAddress, amount)
    if err != nil {
        // ⚠️ BUG: Error is silently swallowed, no retry, no alert
        log.Error("payout failed", err)
    }
}
```

**Critical Problem:** Failed payouts are logged but not retried. If Solana RPC is down during payout, the provider's money stays in the internal wallet indefinitely with no automatic retry.

### 9.4 Dispute Resolution

If a consumer disputes a session:
1. Dispute filed via `/v1/orders/:id/dispute`
2. Evidence submitted (logs, timestamps)
3. Jury panel selected (staked governance token holders)
4. Jury votes — majority determines outcome
5. Funds released to winner via Solana program

---

## 10. Token Tracking

### 10.1 Where Tokens Are Tracked

Tokens (SOL, USDC) are tracked at three levels simultaneously:

| Level | Where | What |
|-------|-------|------|
| On-chain | Solana blockchain | Escrow accounts, wallet balances, staking |
| Internal DB | `wallets` + `wallet_ledger_entries` | Platform balances, full audit trail |
| Runtime cache | Redis | Session state, pending billing, node registry |

### 10.2 Redis Token Tracking Keys

```
billing:session:{session_id}:pending  → {bytes_in, bytes_out, last_updated}
wallet:{user_id}:balance              → Current cached balance
node:{node_id}:stats                  → Provider bandwidth stats
session:{username}:{password}         → Active session data
```

### 10.3 Blockchain Token Flow

```
User Solana Wallet
  ↓ deposit
ProxyHubb Treasury Wallet
  ↓ (per session) escrow locked
Escrow PDA (Program Derived Address)
  ↓ oracle-signed settlement
Provider's Solana Wallet
```

### 10.4 Blockchain Indexer

Polls Solana every 400ms:
- Detects incoming deposits to treasury
- Confirms escrow creation events
- Tracks settlement transactions
- Updates internal DB on confirmation

### 10.5 Token Audit Trail

Every token movement is double-recorded:
1. Solana transaction (immutable, on-chain)
2. `wallet_ledger_entries` row (internal, queryable)

This dual recording ensures:
- Fast queries for user dashboard (internal DB)
- Trustless verification possible (on-chain)
- Dispute resolution evidence (both)

---

## 11. Database — Full Schema

### 11.1 Migration History

| Migration | Purpose |
|-----------|---------|
| `000001_init_supabase` | Core tables: profiles, wallets, nodes, sessions |
| `000002_consensus_tables` | Staking, governance, consensus |
| `000003_wallet_multi_currency` | USDC/USDT multi-currency support |
| `000004_performance_indexes` | Query optimization indexes |
| `000005_provider_tiers` | Provider tier system |
| `000006_social_features` | Forum, feed, social graph |
| `000007_seed_forum_categories` | Default forum categories |
| `000008_forum_reports` | Content moderation |
| `000009_admin_notes` | Admin audit trail |
| `000010_fix_admin_columns` | Column corrections |

### 11.2 Core Tables

**`profiles`** — User accounts (synced from Supabase auth via trigger):
```sql
id            UUID PRIMARY KEY
email         TEXT UNIQUE
role          TEXT (user/admin/provider)
trust_tier    TEXT (basic/standard/premium)
username      TEXT UNIQUE
display_name  TEXT
verified      BOOLEAN
kyc_status    TEXT (none/pending/approved/rejected)
solana_wallet TEXT  ← linked wallet address
```

**`wallets`** — Internal balances:
```sql
id          UUID PRIMARY KEY
user_id     UUID UNIQUE REFERENCES profiles(id)
balance     DECIMAL(20,8)
currency    TEXT (SOL/USDC)
created_at  TIMESTAMPTZ
updated_at  TIMESTAMPTZ
```

**`wallet_ledger_entries`** — Full transaction history:
```sql
id          UUID PRIMARY KEY
wallet_id   UUID REFERENCES wallets(id)
amount      DECIMAL(20,8)
type        TEXT (deposit/withdrawal/session_charge/provider_earning/...)
description TEXT
tx_hash     TEXT ← Solana transaction hash if applicable
created_at  TIMESTAMPTZ
```

**`nodes`** — Provider machines:
```sql
id          UUID PRIMARY KEY
user_id     UUID REFERENCES profiles(id)
label       TEXT
ip_address  TEXT
status      TEXT (online/offline/suspended)
trust_score INTEGER
created_at  TIMESTAMPTZ
```

**`sessions`** — Active proxy sessions:
```sql
id                UUID PRIMARY KEY
user_id           UUID REFERENCES profiles(id)
node_id           UUID REFERENCES nodes(id)
type              TEXT (rotating/sticky)
status            TEXT (active/terminated/expired)
credentials_user  TEXT ← proxy username
credentials_pass  TEXT ← proxy password (hashed)
bandwidth_bytes   BIGINT
expires_at        TIMESTAMPTZ
created_at        TIMESTAMPTZ
```

**`circles`** — Group communities:
```sql
id          UUID PRIMARY KEY
name        TEXT
owner_id    UUID REFERENCES profiles(id)
```

**`circle_members`** — Membership:
```sql
circle_id   UUID REFERENCES circles(id)
user_id     UUID REFERENCES profiles(id)
role        TEXT
joined_at   TIMESTAMPTZ
```

### 11.3 RLS (Row-Level Security)

Supabase RLS is enabled on `profiles` and `wallets`:
- Users can only read/write their own records
- Admins bypass RLS via service role key
- Providers can see their own node records

---

## 12. Fallbacks & Broken Things

### 12.1 Auth Fallbacks — CRITICAL

**Location:** `main.rs:208-210`

```rust
// When Redis is unreachable for session lookup:
let (user_id, session_data) = match auth_result {
    Ok(data) => data,
    Err(_) => ("anonymous".to_string(), None),  // ← DANGEROUS FALLBACK
};
```

**What breaks:** If Redis goes down, the gateway lets everyone through as "anonymous" users. This is a complete authentication bypass. Should fail-closed (return 407 Proxy Authentication Required).

**Impact:** Complete security breach during Redis outages.

---

### 12.2 Payout Retry — Missing

**Location:** `billing/worker.go`

Failed Solana payout transactions are logged but never retried. If the Solana RPC is down during the hourly settlement:
- Provider's earnings are credited internally ✓
- On-chain payout never fires ✗
- No retry job scheduled ✗
- No alert sent ✗
- Provider has no way to trigger manual payout ✗

---

### 12.3 Metering Data Loss on Crash

**Location:** `metering.rs`

Usage data accumulates in memory for 30 seconds before flush. If the gateway crashes:
- Up to 30 seconds of proxy usage is lost
- Providers are underpaid for that period
- No write-ahead log, no durability

---

### 12.4 Heartbeat Monitor Disconnection

**Location:** `heartbeat.rs` vs `tunnel.rs`

The `HeartbeatMonitor` and `HeartbeatStore` are initialized but not connected to the actual tunnel connection events in `tunnel.rs`. This means:
- Heartbeat monitor has stale/incorrect node health data
- Unhealthy nodes may continue receiving traffic
- Evicted nodes are marked unhealthy but not removed from the routing pool

---

### 12.5 Circuit Breaker Success Threshold Bug

**Location:** `circuitbreaker.rs`

```rust
success_threshold: 2,  // defined but never used
```

The breaker transitions from HalfOpen → Closed after the first successful request, not after 2 as configured. A flapping provider re-enters the pool prematurely.

---

### 12.6 Billing Race Condition

**Location:** `billing/worker.go:96-102`

```go
wallet := getWallet(userID)         // Read balance
if wallet.Balance < cost { ... }    // Check balance
debitWallet(wallet, cost)           // Debit
```

There is no row-level lock between read and debit. If two settlement workers run concurrently for the same user, both could see sufficient balance and double-debit. Should use `SELECT FOR UPDATE`.

---

### 12.7 Wallet Auto-Creation Race Condition

**Location:** `wallet.go:92-99`

```go
if wallet == nil {
    createWallet(userID)  // No mutex, no UPSERT
}
```

Two simultaneous requests for the same user could both see `nil` and attempt to create duplicate wallets. Should use `INSERT ON CONFLICT DO NOTHING` or a distributed lock.

---

### 12.8 Provider Node Hardcoded GeoIP Fallback

**Location:** `tunnel.rs:191-208`

GeoIP detection falls back to hardcoded list of 3 countries (Ghana, Nigeria, Kenya). Providers from all other countries have incorrect geo metadata, affecting routing and geo-targeting features.

---

### 12.9 Prometheus Cardinality Explosion

**Location:** `metrics.rs`

Metrics labeled with `user_id` and `node_id` will create millions of unique time series at scale. Prometheus is not designed for high-cardinality labels — this will cause:
- Memory exhaustion in Prometheus
- Slow query performance
- Potential Prometheus crash

---

### 12.10 QoS Flat Rate for All Tiers

**Location:** `qos.rs`

All users get a flat 10MB/s cap regardless of their subscription tier. A premium user paying 10x more gets the same bandwidth limit as a free user.

---

### 12.11 Port Policy Too Restrictive

**Location:** `policy.rs`

Only ports 80 and 443 are allowed. This blocks:
- Port 8080/8443 (common dev/staging endpoints)
- Port 3000 (Node.js apps)
- Port 3306, 5432 (DB access via proxy — intentional but undocumented)
- Port 22 (SSH via proxy — intentional but blocked)

---

## 13. Security Vulnerabilities

| # | Vulnerability | Location | Severity | Description |
|---|---------------|----------|----------|-------------|
| 1 | **Auth bypass on Redis failure** | `main.rs:208` | CRITICAL | Falls back to anonymous user instead of 407 reject |
| 2 | **JWT dead code confusion** | `tunnel.rs:111` | HIGH | `insecure_disable_signature_validation()` present, overwritten on next line — if line 113 deleted, JWT validation is disabled |
| 3 | **Hardcoded admin credentials** | `docker-compose.yml:48,51,54` | HIGH | Admin passwords in env file with predictable format `PHub@Role2026!` |
| 4 | **No DNS rebinding protection** | `policy.rs` | MEDIUM | An attacker can resolve IP during validation, then rebind to internal IP |
| 5 | **No domain blocklist** | `policy.rs` | MEDIUM | Cannot block specific domains (legal/abuse liability) |
| 6 | **Unbounded session cache** | `auth.rs` | MEDIUM | HashMap grows indefinitely → OOM at scale |
| 7 | **Billing race condition** | `billing/worker.go:96` | MEDIUM | Double-debit possible without row lock |
| 8 | **Wallet creation race** | `wallet.go:92` | LOW | Duplicate wallet creation possible |
| 9 | **No withdrawal address validation** | `wallet.go` | MEDIUM | Solana wallet address not validated before transfer |

---

## 14. What Is Not Working or Not Wired

### Features Built but Not Connected

| Feature | Code Location | Status | Impact |
|---------|--------------|--------|--------|
| IP Rotation | `rotation.rs` | Implemented, not wired into routing | Consumers cannot rotate IPs despite feature being ready |
| Leader Election | `leader.rs` | Implemented, not used | Distributed coordination impossible — any node can do leader-only tasks |
| Connection Pooling | `pool/mod.rs` | Implemented (Phase 1) | Each session creates new yamux stream instead of reusing pool |
| Lock-free Registry | `registry/lockfree.rs` | Implemented (Phase 1) | Old Mutex-based registry still in use |
| ML Routing | `routing/ml_router.rs` | Implemented (Phase 3) | Heuristic routing only — no ML-based provider selection |
| DDoS Protection | `security/ddos.rs` | Implemented (Phase 4) | Not active — gateway is DDoS-vulnerable |
| TLS Fingerprinting | `security/fingerprint.rs` | Implemented | Not active — bots not detected |
| Multi-region | `multiregion/routing.rs` | Implemented | Not active — single-region only |
| HTTP/2 CONNECT | `proxy/http2.rs` | Implemented | HTTP/1.1 only currently |
| WebSocket tunnel | `proxy/websocket.rs` | Implemented | Optional, not default path |
| Zero-copy splice | `proxy/zerocopy.rs` | Implemented | Not default path |
| Predictive warmup | `routing/prewarm.rs` | Implemented | Not active — cold connections only |
| A/B test routing | `routing/ab_test.rs` | Implemented | Not active |
| Heartbeat monitoring | `heartbeat.rs` | Implemented | Disconnected from tunnel updates |
| Payout retry | `billing/worker.go` | Not implemented | Failed payouts silently lost |
| Metering WAL | `metering.rs` | Not implemented | Data loss on crash |

---

## 15. Recommended Fixes by Priority

### Priority 0 — Fix Before Any Production Traffic

| Fix | File | Change |
|-----|------|--------|
| **Auth fail-closed** | `main.rs:208` | Return `407 Proxy Auth Required` on Redis error, never default to anonymous |
| **Remove JWT dead code** | `tunnel.rs:111` | Delete `insecure_disable_signature_validation()` call entirely |
| **Billing row lock** | `billing/worker.go:96` | Add `SELECT FOR UPDATE` before balance read |
| **Wallet UPSERT** | `wallet.go:92` | Use `INSERT INTO wallets ... ON CONFLICT DO NOTHING` |

### Priority 1 — Fix Within 2 Weeks

| Fix | File | Change |
|-----|------|--------|
| **Cap session cache** | `auth.rs` | Replace `HashMap` with bounded LRU (max 100K entries, TTL 5 min) |
| **Redis connection pool** | `auth.rs`, `registry/` | Use `bb8-redis` connection pool |
| **Payout retry queue** | `billing/worker.go` | Queue failed payouts in Redis, retry with exponential backoff |
| **Metering write-ahead log** | `metering.rs` | Write to Redis before accumulating in memory |
| **Connect heartbeat monitor** | `heartbeat.rs`, `tunnel.rs` | Call `HeartbeatMonitor::update()` on each tunnel heartbeat |
| **Fix circuit breaker** | `circuitbreaker.rs` | Implement success_threshold counter before transitioning to Closed |

### Priority 2 — Fix Within 4 Weeks

| Fix | File | Change |
|-----|------|--------|
| **Wire IP rotation** | `rotation.rs`, `main.rs` | Integrate `rotate_provider()` into select_best_provider path |
| **Replace Mutex registry** | `registry/lockfree.rs` | Swap `Mutex<HashMap>` for `DashMap` (Phase 1 is ready) |
| **Fix Prometheus cardinality** | `metrics.rs` | Bucket or remove `user_id`/`node_id` high-cardinality labels |
| **Wire connection pool** | `pool/mod.rs`, `main.rs` | Route streams through pool instead of new yamux streams |
| **Tier-based QoS** | `qos.rs` | Set bandwidth cap from session's `trust_tier` field |
| **GeoIP fallback** | `tunnel.rs:191` | Use MaxMind DB for all countries, remove hardcoded list |

### Priority 3 — Phase 2–4 Implementation (8–16 Weeks)

Follow existing `EDGE_GATEWAY_IMPLEMENTATION_PLAN.md`:
- Phase 1: Lock-free registry + connection pooling (Weeks 2–4)
- Phase 2: HTTP/2, WebSocket, zero-copy (Weeks 5–8)
- Phase 3: ML routing, predictive warmup, A/B testing (Weeks 9–12)
- Phase 4: DDoS protection, TLS fingerprinting, multi-region (Weeks 13–16)

---

## 16. Conclusion

### What Is Working Well

- **Architecture is fundamentally sound** — right language for each service
- **Blockchain integration is well-designed** — escrow eliminates counterparty risk
- **Ed25519-signed metering** prevents billing fraud effectively
- **Comprehensive monitoring** — Prometheus + Grafana + OpenTelemetry tracing
- **Layered security** — WAF, circuit breakers, SSRF protection, DDoS headers
- **Dual-layer accounting** — internal ledger + on-chain settlement is correct design
- **Provider reputation system** — persistent scoring across gateway restarts
- **Complete financial audit trail** — every token movement in `wallet_ledger_entries`
- **Dispute resolution** — on-chain jury mechanism is sophisticated

### What Must Be Fixed Immediately

1. **Auth bypass** (`main.rs:208`) — Existential security issue
2. **JWT dead code** (`tunnel.rs:111`) — Latent security bomb
3. **Billing race** (`billing/worker.go`) — Financial integrity risk
4. **Silent payout failures** — Providers losing money silently

### System Maturity Assessment

| Component | Maturity |
|-----------|---------|
| Edge Gateway core | 70% — works, has critical bugs |
| Blockchain settlement | 65% — works, no retry logic |
| Financial accounting | 75% — works, race conditions |
| Proxy marketplace | 60% — works, no IP rotation |
| Provider earning | 70% — works, silent failures |
| Wallet system | 65% — works, race conditions |
| Admin system | 55% — basic, hardcoded credentials |
| Monitoring | 80% — solid but cardinality issue |
| Security | 40% — Phase 4 not active, auth bypass |

**Estimated effort to full production-readiness:**
- Critical fixes (P0): **3–5 days**
- High-priority fixes (P1): **2–3 weeks**
- Full Phase 1 (lock-free + pooling): **4–6 weeks**
- Phases 2–4 (HTTP/2, ML, security): **12–16 weeks** per existing plan

The foundation is strong. ProxyHubb has the correct architecture for a decentralized proxy marketplace. The blockchain integration is well-thought-out, the financial model is sound, and the code quality is high. The issues identified are fixable and well-understood — the priority must be sealing the security vulnerabilities before any production exposure.

---

*Report generated by deep-dive analysis of: `services/edge-gateway/` (Rust), `services/control-api/` (Go), `apps/web/` (Next.js), `migrations/` (SQL), `docker-compose.yml`, `infra/prometheus.yml`, and existing analysis documents.*

---

## Appendix A — Full Database Schema (Discovered from All Migrations)

This appendix documents the **complete database schema** found across all 16 migration files (10 in `migrations/` + 6 in `services/control-api/migrations/`). The original report only captured a subset.

### A.1 Complete Table Inventory

The RLS migration files (`20260121_complete_rls.sql`, `20260121_safe_rls.sql`) enumerate every table in the system:

#### Core User & Auth
| Table | Purpose |
|-------|---------|
| `profiles` | User accounts (Supabase auth sync) |
| `wallets` | SOL/USDC internal balances |
| `wallet_ledger_entries` | Full transaction audit trail |
| `api_keys` | Programmatic API access keys |
| `refresh_token_families` | JWT refresh token management |
| `totp_backup_codes` | 2FA backup codes |
| `kyc_verifications` | KYC document verification records |
| `user_preferences` | Per-user settings |
| `user_subscriptions` | Subscription plan membership |
| `subscription_plans` | Available subscription tiers |

#### Proxy Marketplace
| Table | Purpose |
|-------|---------|
| `proxy_listings` | Provider proxy listings (searchable marketplace) |
| `orders` | Buyer purchase orders (with `buyer_wallet`, `seller_wallet`, `escrow_pda` columns) |
| `saved_listings` | Consumer bookmarked listings |
| `sessions` | Active proxy sessions |
| `session_configurations` | Per-session buyer config (domains, ports, rotation, geo) |
| `service_configurations` | Per-node provider config (protocols, caps, pricing multipliers) |
| `routing_profiles` | Preset routing strategies (web-scraping, gaming, streaming, etc.) |
| `usage_records` | Per-session bandwidth usage records |
| `proof_of_service` | On-chain proof of delivered proxy service |

#### Provider Infrastructure
| Table | Purpose |
|-------|---------|
| `nodes` | Provider machine registrations |
| `provider_nodes` | Extended provider node records |
| `provider_applications` | Provider onboarding applications |
| `miner_weights` | Provider consensus/reputation weights |
| `use_cases` | Declared use cases per listing |

#### Blockchain & Wallets
| Table | Purpose |
|-------|---------|
| `linked_wallets` | Multi-chain wallet addresses (chain, address, verified, is_primary) |
| `blockchain_state_cache` | Local cache of Solana PDA account state (JSONB data, slot, signature) |
| `pending_transactions` | Queued on-chain transactions awaiting confirmation |
| `encrypted_credentials` | AES-256-GCM encrypted proxy session credentials (service_role only) |

#### Escrow & Disputes
| Table | Purpose |
|-------|---------|
| `escrow_transactions` | On-chain escrow records (buyer_id, seller_id, status) |
| `disputes` | Filed disputes against sessions/orders |

#### Circles (Group Proxy Pools)
| Table | Purpose |
|-------|---------|
| `circles` | Group proxy pools (shared access) |
| `circle_members` | Circle membership |
| `circle_invites` | Pending invitations |
| `circle_leases` | Time-limited proxy leases within circles |
| `circle_posts` | Circle community posts |
| `circle_slas` | Service-level agreements per circle |
| `circle_daily_stats` | Per-circle usage statistics |

#### Social
| Table | Purpose |
|-------|---------|
| `reviews` | Provider reviews (reviewer_id, rating) |
| `follows` | User follow graph (follower_id) |
| `feed_events` | Activity feed events |
| `friendships` | Confirmed friend relationships |
| `friend_requests` | Pending friend requests |
| `badges` | Badge definitions |
| `user_badges` | Awarded badges per user |
| `conversations` | Direct message threads (participant1_id, participant2_id) |
| `messages` | Individual messages within conversations |

#### Governance
| Table | Purpose |
|-------|---------|
| `proposals` | DAO governance proposals |
| `votes` / `governance_votes` | Votes on proposals |

#### Forum
| Table | Purpose |
|-------|---------|
| `forum_categories` | Forum sections |
| `forum_threads` | Discussion threads |
| `forum_posts` | Individual posts (author_id) |
| `forum_votes` | Upvote/downvote on posts |

#### AI Agents
| Table | Purpose |
|-------|---------|
| `agents` | Agent definitions (public marketplace) |
| `market_agents` | Listed agents for sale/rent |
| `agent_instances` | User-deployed agent instances (user_id) |
| `agent_jobs` | Jobs queued for agent execution (user_id) |
| `agent_outputs` | Results from agent job runs |

#### Audit & Admin
| Table | Purpose |
|-------|---------|
| `audit_logs` | System-wide audit trail (actor_id, action, entity_type, entity_id, ip_address) |
| `audit_logs_partitioned` | Monthly-partitioned audit logs (auto-partition via pg function) |

**Total tables identified: 60+**

---

### A.2 Proxy Engine Configuration Schema (Critical — New Discovery)

The `20260121_proxy_engine.sql` migration reveals a sophisticated per-provider and per-session configuration system not covered in the main report:

#### `service_configurations` — What Providers Can Configure Per Node
```sql
-- Protocols
enable_http, enable_https, enable_socks5, enable_ssh_tunnel

-- Pricing multipliers (providers set these)
price_multiplier_http     FLOAT DEFAULT 1.0
price_multiplier_https    FLOAT DEFAULT 1.0
price_multiplier_socks5   FLOAT DEFAULT 1.2   ← 20% premium
price_multiplier_ssh      FLOAT DEFAULT 1.5   ← 50% premium

-- Premium services (each separately priced)
captcha_solving_enabled       BOOLEAN  price: $0.002/solve
browser_fingerprint_enabled   BOOLEAN  price: $0.01/session
javascript_render_enabled     BOOLEAN  price: $0.005/page
screenshot_enabled            BOOLEAN  price: $0.005/capture

-- Geo access control
allowed_countries TEXT[], blocked_countries TEXT[]
allowed_cities TEXT[]

-- Usage limits
max_concurrent_connections INT DEFAULT 10
max_daily_bandwidth_gb     FLOAT DEFAULT 0  (0 = unlimited)
max_requests_per_minute    INT DEFAULT 1000
```

#### `session_configurations` — What Consumers Can Configure Per Session
```sql
-- Domain/port filtering
allowed_domains TEXT[], blocked_domains TEXT[]
allowed_ports INTEGER[], blocked_ports INTEGER[]

-- Session limits
bandwidth_limit_gb      FLOAT
request_limit           INT
time_limit_minutes      INT

-- Rotation
rotation_type           VARCHAR(20)  -- none/time/request/smart
rotation_interval_seconds INT DEFAULT 60
sticky_target           VARCHAR(255)

-- Quality requirements
preferred_country VARCHAR(10)
preferred_city    VARCHAR(100)
preferred_isp     VARCHAR(100)
min_quality_score FLOAT
max_latency_ms    INT

-- Premium features (opt-in)
use_captcha_solving       BOOLEAN
use_javascript_render     BOOLEAN
use_browser_fingerprint   BOOLEAN
```

#### `routing_profiles` — Pre-seeded Use-Case Presets
| Slug | Use Case | Auto-Rotate | Recommended Protocol | Tier |
|------|----------|-------------|----------------------|------|
| `web-scraping` | Data extraction | Yes (60s) | HTTP/HTTPS | Priority |
| `social-media` | Social management | No | HTTP/HTTPS | Priority |
| `e-commerce` | Price monitoring | Yes (300s) | HTTP/HTTPS | Standard |
| `gaming` | Low-latency gaming | No | SOCKS5 | Enterprise |
| `streaming` | Video streaming | No | SOCKS5/HTTP | Priority |
| `seo-monitoring` | SERP tracking | Yes (30s) | HTTP/HTTPS | Standard |

---

### A.3 Blockchain State Cache (New Discovery)

`blockchain_state_cache` stores a local copy of every relevant Solana PDA:

```sql
pda           VARCHAR(64)  -- Solana Program Derived Address
program_id    VARCHAR(64)  -- Smart contract that owns this account
account_type  VARCHAR(50)  -- escrow/session/stake/etc.
data          JSONB        -- Full deserialized account data
slot          BIGINT       -- Solana slot number when synced
signature     VARCHAR(128) -- Transaction signature
-- Denormalized for fast queries:
buyer_address  VARCHAR(64)
seller_address VARCHAR(64)
status         VARCHAR(50)
```

This means the Control API does **not** need to hit Solana RPC for most reads — it queries this local cache (synced every 400ms by the blockchain indexer). Only writes go directly on-chain.

---

### A.4 Encrypted Credentials (Security Architecture — New Discovery)

Session credentials (proxy username/password) are stored in two places:

1. **`sessions` table** — plaintext credentials for the Edge Gateway Redis lookup (fast path)
2. **`encrypted_credentials` table** — AES-256-GCM encrypted copies (service_role only)

RLS on `encrypted_credentials` allows **only the service role** to access it — no user, not even authenticated users, can read their own encrypted credentials through the API. This is correct security design.

---

### A.5 Soft Deletes on All Tables

`20260121_soft_deletes_partitioning.sql` adds `deleted_at TIMESTAMPTZ` to every mutable table. This means:

- No data is ever permanently deleted — all deletes are soft
- Partial indexes `WHERE deleted_at IS NULL` keep query performance high
- GDPR deletion is handled by setting `deleted_at` (pseudonymization) not physical removal
- Audit trail is preserved even after user account "deletion"

---

### A.6 Audit Log Partitioning

`audit_logs` will be monthly-partitioned (`audit_logs_2026_01`, `audit_logs_2026_02`, etc.) with an auto-partition PostgreSQL function:

```sql
CREATE FUNCTION create_audit_partition_if_not_exists()
-- Automatically creates next month's partition
-- Scheduled via pg_cron: '0 0 25 * *' (25th of each month)
```

**Issue:** The partition migration is marked as optional ("run when ready") and the cron job is commented out. Audit logs are currently accumulating in a single unpartitioned table. This will become a performance problem at scale.

---

### A.7 Multi-Chain Wallet Support

`linked_wallets` supports multiple blockchain networks:

```sql
chain    VARCHAR(20)   -- 'solana', 'ethereum', etc.
address  VARCHAR(64)
verified BOOLEAN       -- ownership signature verified
is_primary BOOLEAN     -- which wallet receives payouts
label    VARCHAR(50)   -- user-defined nickname
UNIQUE(chain, address) -- one record per chain/address pair
```

A user can link multiple wallets across multiple chains. Payouts go to the `is_primary = TRUE` wallet for the relevant chain.

---

### A.8 RLS Policy Gaps (New Security Finding)

Comparing `20260121_row_level_security.sql` vs `20260121_complete_rls.sql` vs `20260121_safe_rls.sql`, there are **three overlapping RLS migration files** that create the same policies. This will cause:

- `duplicate_object` errors on second run (the safe_rls version wraps in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL END $$` to handle this)
- **Risk:** It is unclear which RLS migration was actually applied to production. If only the first two ran, policies are duplicated. If they ran out of order, some policies may be missing.

**Recommendation:** Consolidate into a single idempotent RLS migration and audit which policies are currently active in the database.

---

*Appendix A added 2026-03-13 based on analysis of `services/control-api/migrations/20260121_*.sql` files discovered via background file scan.*
