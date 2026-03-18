# ProxyHub Provider Engine — Deep Dive Analysis Report

**Date**: 2026-03-16
**Scope**: Full provider system across control-api (Go), edge-gateway (Rust), provider-cli (Go), and web frontend (TypeScript/Next.js)
**Analyst**: Claude Sonnet 4.6 (AI Code Analysis)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Provider Registration & Onboarding](#2-provider-registration--onboarding)
3. [Provider Tier System](#3-provider-tier-system)
4. [Provider Node Management](#4-provider-node-management)
5. [Edge Gateway Integration](#5-edge-gateway-integration)
6. [Provider CLI Tool](#6-provider-cli-tool)
7. [Billing, Payments & Revenue Sharing](#7-billing-payments--revenue-sharing)
8. [Sessions & Order Flow](#8-sessions--order-flow)
9. [Marketplace & Listings](#9-marketplace--listings)
10. [Provider Tokens & Authentication](#10-provider-tokens--authentication)
11. [Subscriptions & Plans](#11-subscriptions--plans)
12. [Treasury & Batch Payouts](#12-treasury--batch-payouts)
13. [Spending Limits](#13-spending-limits)
14. [Analytics & Monitoring](#14-analytics--monitoring)
15. [Frontend Provider Dashboard](#15-frontend-provider-dashboard)
16. [Pros & Strengths](#16-pros--strengths)
17. [Cons & Weaknesses](#17-cons--weaknesses)
18. [Critical Bugs & Security Issues](#18-critical-bugs--security-issues)
19. [Missing Features & Gaps](#19-missing-features--gaps)
20. [Architectural Concerns](#20-architectural-concerns)
21. [Priority Fix Roadmap](#21-priority-fix-roadmap)

---

## 1. System Overview

ProxyHub's provider engine is a **multi-layer distributed system** that enables individuals or organizations to contribute proxy nodes to the network and earn SOL-based payments for bandwidth delivered. The system spans five distinct layers:

```
┌─────────────────────────────────────────────────────┐
│              Web Dashboard (Next.js)                 │
│    /dashboard/provider  |  /marketplace              │
└──────────────────────┬──────────────────────────────┘
                       │ REST + WebSocket
┌──────────────────────▼──────────────────────────────┐
│           Control API (Go / Gin)                     │
│  Provider Tiers | Listings | Orders | Sessions       │
│  Billing | Analytics | Treasury | Notifications      │
└──────┬─────────────────────────┬────────────────────┘
       │ Redis (session state)   │ PostgreSQL
┌──────▼──────────────────────┐  │
│   Edge Gateway (Rust/Axum)  │  │
│   Proxy Auth | Tunnel | QoS │  │
│   Metrics | Circuit Breaker │  │
└──────┬──────────────────────┘  │
       │ TLS Tunnel               │
┌──────▼──────────────────────┐  │
│    Provider Node (CLI)       │  │
│    proxyhub-provider daemon  │  │
└─────────────────────────────┘  │
                                  │
┌─────────────────────────────────▼─────────────────┐
│          Solana Blockchain                          │
│   Escrow PDAs | Oracle Claims | On-chain Registry  │
└────────────────────────────────────────────────────┘
```

**Key Technologies**:
- Backend API: Go 1.22+, Gin, GORM, Redis, PostgreSQL
- Gateway: Rust (Axum), Tokio async runtime, Redis, gRPC (proto definitions present)
- Blockchain: Solana, SOL-only payments
- Frontend: Next.js 14+, React Query, TypeScript
- CLI: Go, Cobra framework, systemd integration

---

## 2. Provider Registration & Onboarding

### 2.1 Node Registration Flow

**File**: `services/control-api/internal/api/` (nodes, session, listings handlers)
**Model**: `services/control-api/internal/models/node.go`

```
Provider → CLI wizard → POST /api/nodes/register
         → Control API validates token
         → Inserts node row (PostgreSQL)
         → Returns node_id + gateway_address
         → CLI dials edge gateway TLS tunnel
         → Gateway registers in Redis registry
```

**Node fields collected at registration**:
| Field | Type | Purpose |
|-------|------|---------|
| `ip_address` | string | Public IP of the node |
| `port` | int | Listening port |
| `protocol` | string | http / socks5 / https |
| `connection_type` | string | residential / mobile / datacenter |
| `country` | string | ISO country code |
| `isp` | string | Internet Service Provider name |
| `max_connections` | int | Capacity cap |
| `bandwidth_limit` | int | MB/s limit |
| `net_uid` | string | On-chain NetUID (Solana) |
| `hotkey` | string | Solana hotkey for on-chain identity |

### 2.2 CLI Setup Wizard

**File**: `services/control-api/cmd/provider-cli/cmd/wizard.go`

The wizard provides an interactive terminal UI guiding providers through:
1. Connection type selection
2. Performance parameters (max connections, bandwidth)
3. TLS configuration
4. Gateway address entry
5. Automatic node registration
6. Optional systemd service installation

### 2.3 Issues Found in Registration

- **No email verification** step before node activation
- **No KYC/identity check** (files for kyc.go have been deleted — `D services/control-api/internal/api/kyc.go`)
- **No IP ownership verification** — a provider can register any IP address
- **No duplicate IP detection** — same IP can be registered multiple times by different providers
- **Gateway address is static config** — no mechanism to update it without re-registering

---

## 3. Provider Tier System

### 3.1 Tier Definitions

**File**: `services/control-api/internal/api/provider_tiers.go`

| Tier | Score Req | Uptime | Sessions | Disputes | Benefits |
|------|-----------|--------|----------|----------|---------|
| Unverified | < 20 | — | 0 | — | Basic access only |
| Basic | ≥ 20 | ≥ 90% | ≥ 1 | — | Standard listings |
| Verified | ≥ 50 | ≥ 95% | ≥ 100 | — | Featured listings |
| Premium | ≥ 75 | ≥ 98% | ≥ 500 | 0 | Priority routing |
| Enterprise | ≥ 90 | ≥ 99% | ≥ 2000 | 0 | Custom SLA |

### 3.2 Score Calculation

**File**: `services/control-api/internal/worker/tier_evaluator.go`

```
score = (uptime% / 100) × 40
      + min(sessions / 2000, 1) × 30
      - min(disputes × 10, 30)      ← dispute penalty
      + latency_bonus               ← +10 if <100ms, +5 if <250ms
```

Maximum possible score: **80** (without latency bonus of max 10 = 90 theoretical)

The evaluator runs as a **hourly background worker** scanning all provider records.

### 3.3 Issues Found

- `TotalSessionsServed` field is **never incremented** in the session completion handlers — tier scores will always reflect 0 sessions
- `DisputeCount` field exists but there is **no dispute submission or resolution API**
- **No tier demotion notification** — providers are silently downgraded with no alert
- **No grace period** for temporary downtime (single failed eval causes demotion)
- Latency bonus uses node-reported latency — **no independent verification**
- Score cap of 90 means Enterprise tier (requires score ≥ 90) is nearly **unreachable** without perfect conditions

---

## 4. Provider Node Management

### 4.1 Node Lifecycle

**Model**: `services/control-api/internal/models/node.go`

```
registered → active → (sessions assigned) → degraded → deactivated
                              ↓
                        soft_deleted (deleted_at set)
```

### 4.2 Quality Score Metrics

Each node tracks:
- `latency_ms` — milliseconds (lower = better)
- `success_rate` — float64 0.0–1.0
- `uptime_pct` — percentage
- `quality_score` — 0–100 composite
- `active_connections` — current live connections
- `total_bandwidth_used` — lifetime bytes served
- `last_heartbeat` — last seen timestamp

**Quality Score Formula** (from model):
```
quality = uptime(40%) + success_rate(40%) + latency_component(20%)
earnings_multiplier = 0.70 + (quality/100) × 0.55   → range [0.70, 1.25]
```

### 4.3 Node Sync with Blockchain

**File**: `services/control-api/internal/indexer/node_sync.go`

- Polls Solana on-chain registry for registered nodes
- Syncs `net_uid`, `hotkey`, `on_chain_registered` status
- Creates/updates local DB records to match chain state
- Does NOT delete local nodes that disappear from chain (safety measure)

### 4.4 Issues Found

- **No heartbeat timeout enforcement** — `last_heartbeat` is stored but no worker marks nodes offline when heartbeat lapses
- **Soft-delete gaps** — some session-assignment queries do not filter `deleted_at IS NULL`, allowing deleted nodes to receive sessions
- **No maximum node limit per provider** — a single provider could register thousands of nodes, monopolizing the network
- **Bandwidth counter never resets** — `total_bandwidth_used` only increments, no monthly reset or billing-cycle rollover

---

## 5. Edge Gateway Integration

### 5.1 Architecture

**Files**: `services/edge-gateway/src/` (main.rs, auth.rs, tunnel.rs, policy.rs, registry/store.rs, control_api.rs)

The Rust edge gateway sits between end-users and provider nodes:

```
Client Request
    │  Proxy-Authorization: Basic <session_token>
    ▼
Edge Gateway (Axum)
    │  1. Extract session token from header
    │  2. Redis lookup → SessionData { provider_id, bandwidth_limit, ... }
    │  3. Check bandwidth remaining
    │  4. Apply domain filter policy
    │  5. Forward to provider node via TLS tunnel
    │  6. Stream response back
    │  7. Update Redis usage counter
    ▼
Provider Node (CLI daemon)
```

### 5.2 Session Data in Redis

**File**: `services/edge-gateway/src/auth.rs`

```rust
struct SessionData {
    session_id: String,
    provider_id: String,        // which provider to route to
    bandwidth_limit: u64,       // bytes
    bandwidth_used: u64,        // running counter
    domain_filter: Vec<String>, // allowed/blocked domains
    rotation_type: String,      // sticky / rotating
    rotation_interval: u64,     // seconds
    expires_at: i64,            // unix timestamp
}
```

### 5.3 Gateway Features

- **LRU in-memory cache** — reduces Redis round-trips for hot sessions
- **Connection pooling** — 32 Redis connections by default
- **Prometheus metrics** — `/metrics` endpoint for observability
- **Health check** — `/health` endpoint with uptime
- **Circuit breaker** — per-upstream reliability protection
- **TLS termination** — provider tunnel encryption

### 5.4 Issues Found

- **`price_per_gb` missing from SessionData** — gateway cannot enforce per-session pricing dynamically
- **No per-provider circuit breaker** — single circuit breaker for all providers; one bad actor affects all
- **Fixed 32 Redis connections** — hardcoded constant, not configurable via environment
- **No load balancing** — when multiple provider nodes match a session, always picks first healthy one
- **No geographic routing** — session is not matched to the closest provider node
- **gRPC proto files exist** (`services/edge-gateway/proto/`) but implementation completeness is unclear
- **Bandwidth counter race condition** — concurrent requests may read stale bandwidth_used before writes flush

---

## 6. Provider CLI Tool

### 6.1 Command Structure

**Files**: `services/control-api/cmd/provider-cli/cmd/`

```
proxyhub-provider
├── config
│   ├── init          → Create default config file
│   ├── set <k> <v>   → Set config value
│   ├── get <k>       → Get config value
│   └── show          → Display full config
├── node
│   ├── register      → Interactive registration
│   ├── start         → Connect to gateway + begin serving
│   ├── stop          → Graceful shutdown
│   ├── list          → Show all registered nodes
│   ├── status        → Real-time node metrics
│   ├── metrics       → Historical performance data
│   └── logs          → Stream node logs
├── wizard            → Full interactive setup guide
├── doctor            → System health diagnostics
├── service           → systemd service management
└── version           → Show CLI version info
```

### 6.2 CLI Internals

**Directory**: `services/control-api/cmd/provider-cli/internal/`

| Package | Purpose |
|---------|---------|
| `config/` | YAML config file read/write, env override |
| `proxy/` | HTTP/SOCKS5 proxy handler implementation |
| `stats/` | Metrics collection and display |
| `tunnel/` | TLS tunnel to edge gateway |

### 6.3 Distribution

**File**: `services/control-api/internal/api/cli_distribution.go`

- Signed binary downloads via control API
- Version-checked downloads
- OS/architecture detection

### 6.4 Issues Found

- **No auto-update mechanism** — providers must manually check for CLI updates
- **No bandwidth throttling in CLI** — `bandwidth_limit` is declared but may not be enforced at the process level
- **PID file race condition** — start/stop uses PID file without file locking
- **No reconnect logic documented** — if gateway connection drops, behavior is unclear
- **Wizard does not validate gateway reachability** before completing registration
- **`doctor` command** exists but content not fully analyzed — completeness unknown

---

## 7. Billing, Payments & Revenue Sharing

### 7.1 Payment Model

ProxyHub uses a **pay-as-you-go SOL model**:

```
Consumer pays → Escrow PDA (Solana)
                    ↓ usage verified by oracle
                    ↓ settlement triggered
Provider receives → wallet_address (SOL)
```

**Revenue split** (implied by code but NOT explicitly defined anywhere):
- No commission percentage is hardcoded or configurable in discovered files
- No platform fee collection visible

### 7.2 Usage → Payment Pipeline

```
Edge Gateway
    │  usage_bytes (Redis increment)
    ▼
Control API /usage/report endpoint
    │  aggregates per session/provider
    ▼
Billing Worker (billing/worker.go)
    │  calculates SOL amount = bytes × price_per_gb / 1e9
    │  creates payout_record
    ▼
Batch Payout Processor (billing/batch_payout.go)
    │  groups payouts → Solana transaction
    ▼
Blockchain Settlement
    │  escrow.Settle() → provider wallet
    ▼
Provider receives SOL
```

### 7.3 Batch Payout Details

**File**: `services/control-api/internal/billing/batch_payout.go`

- Configurable batch size and immediate-threshold
- Priority queue: immediate payouts (above threshold) processed first
- `tx_hash` stored per batch for audit trail
- Failed batches retried with exponential backoff (details unclear)
- Cost savings metric tracked

### 7.4 Issues Found

- **No platform commission deducted** — 100% appears to go to provider (likely unintentional)
- **No provider earnings dashboard** — providers cannot see pending/completed payouts
- **SOL price volatility** — price_per_gb stored in listing currency but SOL/USD rate fluctuates; no hedging
- **Oracle signature verification** — usage claims require oracle signature but oracle implementation not visible
- **Double-payout risk** — no idempotency key visible on batch payout creation
- **Payout failures are silent** — retry mechanism exists but provider is not notified of failed payouts
- **No withdrawal interface** — providers cannot manually trigger a payout or set minimum payout threshold

---

## 8. Sessions & Order Flow

### 8.1 Session Types

**File**: `services/control-api/internal/api/session.go`

| Type | Description | Use Case |
|------|-------------|---------|
| `rotating` | IP changes on each request | Scraping, anonymity |
| `sticky` | Same IP held for duration | Authenticated browsing |
| `universal` | Instant session, flexible | General purpose |

### 8.2 Session Creation Flow

```
POST /api/sessions/create
    │  Validate user auth + spending limits
    │  Check provider listing availability
    │  Lock listing in Redis (concurrency control)
    │  Create session record (PostgreSQL)
    │  Generate session credentials (token)
    │  Write SessionData to Redis (gateway reads this)
    │  Return: proxy_host, proxy_port, username, password
    ▼
Consumer uses: curl -x http://username:password@gateway:port https://target.com
```

### 8.3 Session Termination

- Automatic: bandwidth exhausted → gateway stops forwarding → status = `expired`
- Manual: `DELETE /api/sessions/{id}` → deletes Redis key → gateway rejects further requests
- TTL-based: sessions have optional `expires_at` field

### 8.4 Issues Found

- **Session token entropy** — credential generation algorithm not audited
- **Redis key expiry not synchronized** with PostgreSQL `expires_at` — keys may outlive or expire before DB record
- **No session transfer** — if gateway restarts, active sessions are lost (no persistence layer for in-flight sessions)
- **Concurrent session count not enforced server-side** — trust-tier limits checked at creation but not enforced at gateway level
- **No session resume** — disconnected sessions cannot be resumed; new session must be created

---

## 9. Marketplace & Listings

### 9.1 Listing Model

**File**: `services/control-api/internal/api/listings.go`

Each listing represents a provider's offering:
- `price_per_gb` — SOL price
- `bandwidth_available` — MB total offered
- `quality_score` — copied from node quality
- `uptime_pct` — provider uptime
- `bulk_discount_pct` — % off for large orders
- `rotation_type` — rotating / sticky
- `max_concurrent` — max simultaneous sessions
- `status` — active / paused / deleted

### 9.2 Featured Listings

Listings with `quality_score > 70` are promoted in "featured" section. This creates a **quality-incentivized market** but the threshold is static and not adjustable.

### 9.3 Issues Found

- **No listing verification** — providers can set any quality_score; no cross-check with actual node metrics
- **Bandwidth_available not decremented** in real-time — shows stale availability
- **Bulk discount not enforced** at payment level — stored but not applied in billing calculations
- **No SLA guarantee** — listings promise uptime% but no enforcement mechanism
- **Featured listing manipulation** — no protection against gaming quality_score
- **No listing expiry** — stale listings from inactive providers remain visible

---

## 10. Provider Tokens & Authentication

### 10.1 Token Architecture

**Files**: `services/control-api/internal/models/provider_token.go`, `services/control-api/internal/middleware/provider_token_auth.go`

```
Provider creates token → 256-bit random raw value
                       → SHA256 hash stored in DB
                       → masked display: "phx_abc...xyz"
Provider uses token    → Bearer <raw_token>
Middleware validates   → SHA256(raw_token) == stored_hash
```

### 10.2 Middleware Flow

```go
// provider_token_auth.go
1. Extract "Bearer <token>" from Authorization header
2. Try JWT validation first (supabase token)
3. If JWT fails → try provider token lookup
4. Hash incoming token → query DB
5. Update last_used_at
6. Set user context → proceed
```

### 10.3 Issues Found

- **JWT `validateJWT()` is a stub** — always returns error, forcing all requests through token path; no actual JWT parsing implemented
- **SHA256 is fast to brute-force** — tokens should use `bcrypt` or `Argon2id` for hashing
- **No token rotation policy** — tokens have optional expiry but no forced rotation
- **No scope system** — tokens have read/write to everything; no granular permissions
- **No token revocation cascade** — revoking a token does not terminate active sessions using that token
- **`last_used_at` write amplification** — every API request triggers a DB update

---

## 11. Subscriptions & Plans

### 11.1 Plan Capabilities

**File**: `services/control-api/internal/api/subscriptions.go`

Plans control:
- Maximum number of active listings
- API access level (basic / advanced / full)
- Bandwidth allocation
- Monthly billing via SOL

### 11.2 Issues Found

- **No plan enforcement at listing creation** — listing_count vs plan limit not checked
- **SOL charge for subscriptions** — debited from wallet but no receipt/invoice generated
- **Plan downgrade** — when user downgrades, excess listings are not handled (not paused or deleted)
- **No free tier** — no way to try the platform without a subscription payment

---

## 12. Treasury & Batch Payouts

### 12.1 Treasury Manager

**File**: `services/control-api/internal/treasury/treasury_manager.go`

Manages the protocol's reserve wallet:

| Environment | Min Balance | Max Balance | Check Interval |
|-------------|-------------|-------------|---------------|
| DevNet | 5 SOL | 50 SOL | 5 min |
| Staging | 50 SOL | 500 SOL | 5 min |
| MainNet | 100 SOL | 1000 SOL | 5 min |

- Auto-topup from liquidity pool when balance drops below min
- Watchtower alerts for low balance
- Manual topup trigger via admin API

### 12.2 Reconciliation

**File**: `services/control-api/internal/treasury/reconciliation.go`

- Daily reconciliation job
- Compares DB payout records vs on-chain transactions
- Flags discrepancies

### 12.3 Issues Found

- **No multi-sig on treasury wallet** — single key controls all funds; critical security risk
- **Auto-topup has no ceiling protection** — if bug causes repeated topups, funds drain
- **Liquidity manager** (`liquidity_manager.go`) — implementation details unclear from analysis
- **Reconciliation failures** — no escalation path if discrepancies found; no automated resolution

---

## 13. Spending Limits

### 13.1 Default Limits by Trust Tier

**File**: `services/control-api/internal/models/spending_limit.go`

| Trust Tier | Daily | Weekly | Monthly |
|------------|-------|--------|---------|
| New | 10 SOL | 50 SOL | 100 SOL |
| Verified | 50 SOL | 200 SOL | 500 SOL |
| Premium | 100 SOL | 500 SOL | 2000 SOL |

### 13.2 Enforcement

- Checked at order/session creation time
- `SpendingWindow` aggregates usage within time window
- Fails gracefully with clear error response

### 13.3 Issues Found

- **No consumer-configurable limits** — users cannot set their own lower limits
- **Limit reset timing** — daily reset at midnight UTC; no timezone awareness
- **Burst attacks** — a user can place many concurrent requests within a single rate-limit window before any is rejected

---

## 14. Analytics & Monitoring

### 14.1 Provider Analytics

**File**: `services/control-api/internal/api/analytics.go`

Available metrics:
- Hourly/daily bandwidth usage
- Geographic distribution (country-level)
- Top destination domains
- Success rate over time
- P50/P95/P99 latency distribution
- Available regions listing

### 14.2 Provider Monitoring (Admin)

**File**: `services/control-api/internal/api/monitoring.go`

- NATS-based operational metrics stream
- Treasury balance polling
- Watchtower integration
- Manual topup trigger

### 14.3 Issues Found

- **Analytics is consumer-side only** — providers have no view of how their nodes are performing
- **No provider earnings chart** — no time-series view of SOL earned per day/week
- **NATS dependency** — monitoring relies on NATS but NATS is not visible in docker-compose services
- **No alerting for node degradation** — no webhook/email when a provider's node quality drops
- **No retention policy** — analytics data appears to accumulate indefinitely

---

## 15. Frontend Provider Dashboard

### 15.1 Existing Pages

| Page | Path | Status |
|------|------|--------|
| Provider Overview | `/dashboard/provider/page.tsx` | Present (new file) |
| Provider Analytics | `/dashboard/provider/analytics/page.tsx` | Present (modified) |
| Provider Services | `/dashboard/provider/services/page.tsx` | Present (modified) |
| Provider Earnings | `/dashboard/earnings/` | Directory exists, content unknown |

### 15.2 Provider API Client

**File**: `apps/web/src/lib/api/provider.ts`

Provides typed wrappers around:
- Node registration/listing
- Listing CRUD
- Token management
- Analytics fetching

### 15.3 Setup Guide Component

**File**: `apps/web/src/components/ProviderSetupGuide.tsx`

Step-by-step onboarding UI guiding providers through:
1. Account creation
2. CLI download
3. Node registration
4. First listing creation

### 15.4 Issues Found

- **Provider dashboard is incomplete** — `/dashboard/earnings/` directory exists but page content unknown
- **No real-time node status** on dashboard (WebSocket connection to node metrics not visible)
- **No payout history table** — providers cannot see historical SOL earnings
- **No node health indicators** — no visual uptime/latency graphs for owned nodes
- **Setup guide is static** — does not update steps based on actual completion status
- **No mobile-responsive design verification** — provider dashboards are complex tables, may break on mobile

---

## 16. Pros & Strengths

### Architecture Strengths

1. **Clean separation of concerns** — Edge Gateway (Rust, performance-critical) cleanly separated from Control API (Go, business logic)
2. **Rust gateway** — excellent choice for high-throughput proxy handling; memory-safe with Tokio async runtime
3. **Redis-first session state** — sessions stored in Redis allows fast lookup at gateway without DB round-trips
4. **Solana blockchain integration** — trustless escrow via PDAs; non-custodial payment model
5. **Five-tier quality system** — graduated provider reputation with measurable, objective criteria
6. **CLI-first provider experience** — providers don't need a browser; full management from terminal
7. **Prometheus metrics** — observability built into the gateway from day one
8. **Soft deletes** — data preservation, supports audit trails and potential recovery

### Feature Completeness Strengths

9. **Batch payout system** — efficient Solana transaction batching reduces gas costs
10. **Spending limits** — protects consumers from runaway spending; tiered by trust level
11. **Oracle-signed usage claims** — cryptographic proof of usage before settlement
12. **Bulk discounts** — marketplace incentive for volume purchasers
13. **Node quality multiplier** — earnings incentive for maintaining high-quality nodes
14. **Provider token system** — separates provider auth from user auth; enables programmatic access
15. **Systemd integration in CLI** — production-grade daemon management for Linux providers

---

## 17. Cons & Weaknesses

### Technical Weaknesses

1. **Incomplete payment pipeline** — the chain from usage → settlement → provider payout has multiple unimplemented steps
2. **No platform commission** — revenue model for ProxyHub itself is undefined in code
3. **Static pricing** — `price_per_gb` is set at listing creation with no dynamic adjustment mechanism
4. **No geographic routing** — sessions not matched to nearest provider, increasing latency unnecessarily
5. **Single-gateway architecture** — all traffic routes through a single edge gateway instance; obvious scaling bottleneck

### Operational Weaknesses

6. **No multi-sig treasury** — single private key controls all protocol funds; catastrophic if compromised
7. **NATS dependency not containerized** — monitoring requires NATS but it's absent from docker-compose
8. **No database migrations for new tables** — several new models (provider_token, spending_limit, batch_payout) added without corresponding migration files in sequence
9. **No environment-specific config validation** — same code runs on devnet/mainnet with only threshold differences
10. **Stale listing data** — bandwidth_available not updated in real-time

### Developer Experience Weaknesses

11. **No OpenAPI/Swagger spec** — no API documentation; frontend and providers must read source code
12. **Inconsistent error handling** — some handlers return raw DB errors to clients
13. **Magic numbers everywhere** — hardcoded values (32 Redis connections, 100 session limit, 0.002 SOL/GB) scattered across files
14. **No integration test coverage** for provider payment flow

---

## 18. Critical Bugs & Security Issues

> **These must be fixed before production deployment.**

### CRITICAL — Security

#### BUG-001: JWT Validation is a Stub
**File**: `services/control-api/internal/middleware/provider_token_auth.go`
**Severity**: CRITICAL
```go
// validateJWT() always returns error
// All requests fall through to token-based auth
// Supabase JWT verification is effectively DISABLED
```
**Impact**: Any user with a valid provider token can bypass JWT scoping.
**Fix**: Implement actual JWT parsing using Supabase JWT secret or JWKS endpoint.

#### BUG-002: Provider Token Uses SHA256 (Brute-Forceable)
**File**: `services/control-api/internal/models/provider_token.go`
**Severity**: HIGH
SHA256 hash of a 256-bit random token is technically secure IF the token space is large enough, but SHA256 allows rainbow table attacks and GPU-accelerated cracking if the token entropy is lower than 256 bits.
**Fix**: Use `bcrypt` (cost ≥ 12) or `Argon2id` for token hashing.

#### BUG-003: Nonce Generation Uses `time.Now().UnixNano()`
**File**: Various crypto/escrow files
**Severity**: HIGH
Predictable nonces in escrow operations allow replay attack construction.
**Fix**: Use `crypto/rand` for all nonce generation.

#### BUG-004: No Multi-Sig on Treasury
**File**: `services/control-api/internal/treasury/treasury_manager.go`
**Severity**: CRITICAL
Single keypair controls all treasury funds.
**Fix**: Implement Squads (Solana multi-sig) for treasury operations requiring ≥ 2-of-3 signatures.

#### BUG-005: Provider Can Register Any IP Address
**File**: Node registration handler
**Severity**: HIGH
No verification that the registering provider actually owns/controls the IP address.
**Fix**: Implement IP verification challenge (HTTP callback to registered IP) before activation.

### HIGH — Data Integrity

#### BUG-006: `TotalSessionsServed` Never Incremented
**File**: `services/control-api/internal/worker/tier_evaluator.go` + session handlers
**Severity**: HIGH
Tier calculation uses session count but it's always 0. All providers stay at Unverified/Basic tier regardless of activity.
**Fix**: Increment `total_sessions_served` in the session completion handler.

#### BUG-007: Soft-Deleted Nodes Can Receive Sessions
**File**: Various session assignment queries
**Severity**: HIGH
Queries selecting available provider nodes may not consistently filter `WHERE deleted_at IS NULL`.
**Fix**: Audit all node selection queries and add `AND deleted_at IS NULL` where missing.

#### BUG-008: Double-Payout Risk in Batch Processor
**File**: `services/control-api/internal/billing/batch_payout.go`
**Severity**: HIGH
No idempotency key visible on batch payout creation. Network failures during Solana submission could cause retry with duplicate payment.
**Fix**: Add idempotency_key (hash of session_ids in batch) and check before submitting.

### MEDIUM — Functional Bugs

#### BUG-009: Bandwidth_Available Not Decremented
**File**: Listing update logic
**Severity**: MEDIUM
`bandwidth_available` on listings shows stale data; consumers may purchase sessions that exceed actual available bandwidth.
**Fix**: Atomically decrement `bandwidth_available` in Redis when session is allocated; sync to DB periodically.

#### BUG-010: Redis Session Key Expiry Out of Sync with DB
**File**: `services/control-api/internal/api/session.go`
**Severity**: MEDIUM
Redis TTL and PostgreSQL `expires_at` can diverge. Sessions may work after DB marks them expired or fail before DB expiry.
**Fix**: Set Redis TTL = DB `expires_at` - now(); update Redis TTL atomically with DB update.

#### BUG-011: No Heartbeat Timeout Enforcement
**File**: `services/control-api/internal/models/node.go`
**Severity**: MEDIUM
`last_heartbeat` updated by CLI but no background job checks for stale heartbeats and marks nodes offline.
**Fix**: Add worker that marks nodes as `status = 'offline'` when `last_heartbeat < NOW() - INTERVAL '5 minutes'`.

---

## 19. Missing Features & Gaps

### P0 — Must Have (Blocking Production)

| # | Feature | Description |
|---|---------|-------------|
| MF-001 | Platform commission | Define and deduct platform fee from provider payouts |
| MF-002 | Provider earnings dashboard | Providers need to see SOL earned, pending payouts |
| MF-003 | Heartbeat worker | Mark nodes offline when heartbeat lapses |
| MF-004 | Session count increment | Fix `TotalSessionsServed` to enable tier promotion |
| MF-005 | Payout failure notifications | Alert providers when a payout fails |
| MF-006 | Provider identity verification | Basic IP verification before node activation |

### P1 — High Priority

| # | Feature | Description |
|---|---------|-------------|
| MF-007 | Dispute system | Consumers can raise disputes; providers can respond |
| MF-008 | Provider payout history | Table of all historical payouts with tx_hash |
| MF-009 | Node health dashboard | Per-node latency/uptime graphs |
| MF-010 | Auto-CLI updates | CLI checks for updates and self-updates |
| MF-011 | Provider withdrawal control | Set minimum payout threshold; manual withdrawal |
| MF-012 | Geographic routing | Route sessions to nearest provider by country |
| MF-013 | Multi-gateway support | Multiple edge gateway instances for redundancy |
| MF-014 | OpenAPI spec | Auto-generated documentation for all endpoints |

### P2 — Medium Priority

| # | Feature | Description |
|---|---------|-------------|
| MF-015 | Free tier | Allow providers to register without subscription |
| MF-016 | Provider tier change alerts | Notify on tier promotion/demotion |
| MF-017 | Consumer spending controls | User-configurable spending limits |
| MF-018 | Listing SLA enforcement | Auto-pause listings when uptime drops below stated % |
| MF-019 | Session resume | Allow disconnected sessions to reconnect |
| MF-020 | Bulk discount enforcement | Apply `bulk_discount_pct` in billing calculations |
| MF-021 | Provider referral tracking | Track which provider referred another |
| MF-022 | Analytics retention policy | Define and enforce data retention for analytics |
| MF-023 | Provider KYC | Identity verification for enterprise-tier providers |

### P3 — Nice to Have

| # | Feature | Description |
|---|---------|-------------|
| MF-024 | Load balancing in gateway | Round-robin / least-connections across provider nodes |
| MF-025 | Price oracle hedge | Lock SOL/USD rate at session start to protect both parties |
| MF-026 | Provider SLA credits | Automatic credit when SLA violated |
| MF-027 | Multi-sig treasury | Squads integration for treasury security |
| MF-028 | Provider reputation NFT | On-chain reputation badge per tier |
| MF-029 | CLI plugin system | Allow providers to extend CLI functionality |
| MF-030 | Mobile-responsive provider UI | Optimize provider dashboard for mobile |

---

## 20. Architectural Concerns

### 20.1 Single Point of Failure: Edge Gateway

Currently, all proxy traffic routes through a single edge gateway instance. There is no visible:
- Horizontal scaling configuration
- Load balancer in front of gateway
- Failover mechanism

**Risk**: Gateway downtime = complete service outage for all consumers and providers.

### 20.2 Eventual Consistency Without Compensation

The usage → payment pipeline has 4+ async stages with no saga/compensation pattern:
```
Edge Gateway → Redis → Control API → Billing Worker → Blockchain
```
If any stage fails silently, usage is recorded but payment never arrives. There is no reconciliation check at each stage boundary.

### 20.3 Missing Service Mesh

Control API ↔ Edge Gateway communication happens entirely through Redis shared state. There is no:
- Request tracing (correlation IDs across services)
- Service-to-service authentication
- gRPC channel for real-time commands (proto files exist but usage unclear)

### 20.4 Database Schema Concerns

- Several new models (provider_token, batch_payout, spending_limit) added as code but migration files are in unknown state
- No database seeding for provider tiers configuration table
- No foreign key constraint visible between `sessions` and `provider_nodes` (relies on application-level integrity)

### 20.5 Provider Data Isolation

Currently a provider's nodes, listings, tokens, and earnings all use `provider_user_id` as the identifier, which is the same as the user's Supabase auth ID. This creates tight coupling:
- A provider cannot have a "team" managing nodes under one account
- No concept of provider organization/company entity
- No delegation or sub-account support

---

## 21. Priority Fix Roadmap

### Phase 1 — Critical Security & Data Integrity (Week 1–2)

```
[ ] BUG-001: Implement real JWT validation in middleware
[ ] BUG-004: Move treasury to multi-sig (Squads)
[ ] BUG-005: Add IP ownership verification challenge
[ ] BUG-006: Increment TotalSessionsServed on session completion
[ ] BUG-007: Audit all node queries for deleted_at filter
[ ] BUG-008: Add idempotency keys to batch payout processor
[ ] BUG-003: Replace time.Now().UnixNano() nonces with crypto/rand
```

### Phase 2 — Core Provider Features (Week 3–4)

```
[ ] MF-001: Define platform commission (suggested: 10-15%)
[ ] MF-002: Build provider earnings dashboard
[ ] MF-003: Implement heartbeat timeout worker
[ ] MF-005: Add payout failure notification system
[ ] BUG-009: Fix bandwidth_available real-time tracking
[ ] BUG-010: Synchronize Redis TTL with DB session expiry
[ ] BUG-011: Add heartbeat timeout enforcement worker
```

### Phase 3 — Provider Growth Features (Week 5–6)

```
[ ] MF-007: Build dispute submission and resolution flow
[ ] MF-008: Provider payout history table and export
[ ] MF-009: Per-node performance graphs in dashboard
[ ] MF-012: Geographic routing in session assignment
[ ] MF-013: Multi-gateway support with load balancer
[ ] MF-020: Enforce bulk_discount_pct in billing
```

### Phase 4 — Scale & Polish (Week 7–8)

```
[ ] MF-014: Generate OpenAPI spec from route definitions
[ ] MF-015: Free tier for new providers
[ ] MF-016: Tier change email/push notifications
[ ] MF-024: Load balancing across provider nodes in gateway
[ ] MF-025: SOL/USD rate lock at session start
[ ] Add integration tests for full payment pipeline
[ ] Add NATS to docker-compose services
```

---

## File Reference Index

| File | Description |
|------|-------------|
| [provider_tiers.go](services/control-api/internal/api/provider_tiers.go) | Tier definitions and promotion logic |
| [provider_token.go (api)](services/control-api/internal/api/provider_token.go) | Token CRUD API handlers |
| [provider_token.go (model)](services/control-api/internal/models/provider_token.go) | Token model with hash/mask helpers |
| [provider_token_auth.go](services/control-api/internal/middleware/provider_token_auth.go) | Auth middleware (JWT + token) |
| [tier_evaluator.go](services/control-api/internal/worker/tier_evaluator.go) | Hourly tier recalculation worker |
| [node.go (model)](services/control-api/internal/models/node.go) | Node entity model |
| [node_sync.go](services/control-api/internal/indexer/node_sync.go) | Blockchain ↔ DB node sync |
| [session.go](services/control-api/internal/api/session.go) | Session creation/management |
| [listings.go](services/control-api/internal/api/listings.go) | Marketplace listing CRUD |
| [orders.go](services/control-api/internal/api/orders.go) | Order creation and tracking |
| [pricing.go](services/control-api/internal/api/pricing.go) | SOL/USD pricing logic |
| [batch_payout.go](services/control-api/internal/billing/batch_payout.go) | Batch SOL payout processor |
| [treasury_manager.go](services/control-api/internal/treasury/treasury_manager.go) | Protocol treasury management |
| [spending_limit.go](services/control-api/internal/models/spending_limit.go) | Consumer spending limits |
| [subscriptions.go](services/control-api/internal/api/subscriptions.go) | Subscription plan management |
| [analytics.go](services/control-api/internal/api/analytics.go) | Usage analytics API |
| [monitoring.go](services/control-api/internal/api/monitoring.go) | Operational monitoring API |
| [main.rs (gateway)](services/edge-gateway/src/main.rs) | Edge gateway entry point |
| [auth.rs](services/edge-gateway/src/auth.rs) | Gateway session authentication |
| [tunnel.rs](services/edge-gateway/src/tunnel.rs) | Provider node tunnel handler |
| [wizard.go](services/control-api/cmd/provider-cli/cmd/wizard.go) | CLI interactive setup wizard |
| [node.go (CLI)](services/control-api/cmd/provider-cli/cmd/node.go) | CLI node management commands |
| [provider.ts](apps/web/src/lib/api/provider.ts) | Frontend provider API client |
| [ProviderSetupGuide.tsx](apps/web/src/components/ProviderSetupGuide.tsx) | Provider onboarding UI component |

---

*Report generated on 2026-03-16. Based on static code analysis of the ProxyHub repository at commit `a23df1a`. Dynamic runtime behavior may differ.*
