# ProxyHub — Full System Analysis Report

**Date:** 2026-03-16
**Analyst:** Claude Sonnet 4.6 (Expert Review)
**Scope:** Full codebase deep-dive — Architecture, Code Quality, Security, Infrastructure, Pros & Cons

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Go Backend — Control API](#3-go-backend--control-api)
4. [Rust Backend — Edge Gateway](#4-rust-backend--edge-gateway)
5. [Frontend — Web Application](#5-frontend--web-application)
6. [Database Architecture](#6-database-architecture)
7. [Docker & Infrastructure](#7-docker--infrastructure)
8. [Solana Blockchain Integration](#8-solana-blockchain-integration)
9. [Security Architecture](#9-security-architecture)
10. [Billing & Settlement System](#10-billing--settlement-system)
11. [Provider CLI Tool](#11-provider-cli-tool)
12. [Observability & Monitoring](#12-observability--monitoring)
13. [Testing Infrastructure](#13-testing-infrastructure)
14. [CI/CD Pipeline](#14-cicd-pipeline)
15. [Pros & Strengths](#15-pros--strengths)
16. [Cons, Risks & Weaknesses](#16-cons-risks--weaknesses)
17. [Recommendations](#17-recommendations)
18. [Component Summary Table](#18-component-summary-table)

---

## 1. Executive Summary

ProxyHub is a **decentralized proxy marketplace platform** — a sophisticated, multi-service system allowing buyers to purchase proxy bandwidth from providers, with payments settled on the Solana blockchain. It is not a simple CRUD application; it incorporates escrow mechanics, real-time session metering, governance, social features, ZK-proofs, AI agent orchestration, and a high-performance Rust-based proxy gateway.

The system is built across four primary language runtimes:

| Layer | Language | Role |
|---|---|---|
| Control API | Go 1.24 | REST API, billing, auth, blockchain |
| Edge Gateway | Rust 1.85 | Proxy server, tunneling, session auth |
| Web Frontend | TypeScript / Next.js | Buyer/Provider UI |
| Blockchain | Solana | SOL payments, escrow, settlement |

The overall architecture follows a **microservice-oriented monolith** pattern where distinct services are independently deployable via Docker but share a PostgreSQL database and Redis cache. NATS JetStream handles asynchronous event propagation between services.

The project is demonstrably production-ambitious: it includes multi-sig oracle security, batch payout optimization, circuit-breaker middleware, audit log partitioning, and a provider tier system — all pointing to an engineering team with deep distributed systems experience.

---

## 2. System Architecture Overview

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ProxyHub Platform                               │
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────────────┐ │
│  │  Web UI       │    │  Admin UI    │    │  Provider CLI             │ │
│  │  Next.js:3000 │    │  Next.js:3002│    │  (Go binary)              │ │
│  └──────┬───────┘    └──────┬───────┘    └────────────┬──────────────┘ │
│         │                   │                          │                │
│         └───────────────────┴──────────────────────────┘               │
│                             │                                          │
│                    ┌────────▼────────┐                                 │
│                    │  Control API    │  Go 1.24 / Gin                  │
│                    │  Port 8080/8081 │  50+ handlers                   │
│                    │                 │  JWT + Supabase Auth            │
│                    └──┬──────────┬──┘                                  │
│                       │          │                                      │
│         ┌─────────────┘          └───────────────────┐                 │
│         │                                            │                 │
│  ┌──────▼──────┐   ┌──────────────┐   ┌─────────────▼──────────┐      │
│  │ PostgreSQL  │   │    Redis     │   │   NATS JetStream        │      │
│  │ Port 5432   │   │  Port 6379   │   │   Port 4222             │      │
│  │ (Supabase)  │   │  (Cache/     │   │   (Async Events)        │      │
│  │             │   │   Pub-Sub)   │   │                         │      │
│  └─────────────┘   └──────────────┘   └─────────────────────────┘      │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                     Edge Gateway (Rust)                            │ │
│  │  Port 3128 (SOCKS5/HTTP Proxy) | Port 8090 (Metrics/Health)       │ │
│  │  Hyper 1.3 | Tokio | Rustls | Prometheus                          │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Observability Stack                                               │ │
│  │  Prometheus:9091 | Grafana:3001 | Redis Exporter:9121             │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Solana Blockchain (Devnet / Mainnet)                              │ │
│  │  SOL Payments | Escrow Smart Contracts | Multi-Sig Oracle          │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### Service Communication Matrix

| From | To | Protocol | Purpose |
|---|---|---|---|
| Web UI | Control API | HTTPS REST + WebSocket | All app data |
| Admin UI | Control API | HTTPS REST | Admin ops |
| Provider CLI | Control API | HTTPS REST | Node mgmt |
| Control API | PostgreSQL | TCP (GORM) | Persistent data |
| Control API | Redis | TCP | Cache, sessions, pub-sub |
| Control API | NATS | TCP | Async events |
| Control API | Solana RPC | HTTPS | Blockchain ops |
| Edge Gateway | Control API | HTTPS | Session verification |
| Edge Gateway | Redis | TCP | Session cache |
| Edge Gateway | Prometheus | HTTP | Metrics scraping |
| Proxy Clients | Edge Gateway | TCP (SOCKS5/HTTP) | Proxy access |

---

## 3. Go Backend — Control API

### Technology Stack

| Component | Library/Version |
|---|---|
| Language | Go 1.24 |
| HTTP Framework | Gin-gonic |
| ORM | GORM |
| Database | PostgreSQL 16 |
| Cache | Redis 7 (go-redis) |
| Messaging | NATS 2.10 + JetStream |
| Auth | Supabase + custom JWT (golang-jwt/jwt) |
| Blockchain | gagliardetto/solana-go |
| Tracing | OpenTelemetry (otlp/jaeger) |
| Logging | rs/zerolog |
| Metrics | Prometheus (client_golang) |

### Package Structure

```
services/control-api/
├── main.go                         # 600-line startup orchestrator
├── go.mod / go.sum
├── cmd/
│   └── provider-cli/               # Provider CLI binary
│       ├── cmd/
│       │   ├── root.go
│       │   ├── node.go
│       │   ├── service.go
│       │   ├── doctor.go
│       │   ├── wizard.go
│       │   └── version.go
│       └── internal/
├── internal/
│   ├── api/                        # 50+ HTTP handler files
│   ├── audit/                      # Audit log system
│   ├── billing/                    # Settlement, batch payouts
│   ├── db/                         # Database init, migrations
│   ├── middleware/                 # Auth, WAF, rate-limiting
│   ├── models/                     # 30+ data models
│   ├── pricing/                    # Dynamic pricing engine
│   ├── solana/                     # Blockchain client
│   ├── testutil/                   # Test helpers
│   ├── treasury/                   # Treasury management
│   └── worker/                     # Background workers
```

### API Handler Inventory (50+ files)

#### Authentication & Identity
| File | Responsibility |
|---|---|
| `auth.go` | Wallet login, nonce challenges, JWT issuance |
| `admin.go` | Admin-only auth, user management |
| `middleware/supabase.go` | Multi-path auth verification |
| `middleware/provider_token_auth.go` | CLI/provider API token auth |

#### Marketplace
| File | Responsibility |
|---|---|
| `listings.go` | Create/browse proxy listings |
| `orders.go` | Purchase orders with escrow |
| `session.go` | Session lifecycle (create/list/terminate) |
| `pricing.go` | Dynamic SOL-based pricing |
| `usage.go` | Bandwidth tracking & billing trigger |
| `smart_matching.go` | Intelligent buyer-to-provider pairing |

#### Finance & Blockchain
| File | Responsibility |
|---|---|
| `wallet.go` | SOL wallet ops, balance, transactions |
| `escrow.go` | Escrow lifecycle management |
| `escrow_milestones.go` | Milestone-based fund release |
| `swap.go` | Token swap operations |
| `subscriptions.go` | Recurring payment management |

#### Social & Community
| File | Responsibility |
|---|---|
| `forum.go` | Threads, posts, voting |
| `messaging.go` | P2P message exchange |
| `circles.go` | Groups / team features |
| `reviews.go` | Ratings and feedback |
| `referral.go` | Referral / affiliate system |

#### Governance & Compliance
| File | Responsibility |
|---|---|
| `governance.go` | On-chain proposal/voting |
| `audit.go` | Audit trail endpoints |
| `trustless.go` | ZK proofs of service |
| `zk_reputation.go` | Privacy-preserving reputation |
| `dispute_jury.go` | Decentralized dispute resolution |

#### Observability
| File | Responsibility |
|---|---|
| `analytics.go` | Usage analytics, trend data |
| `monitoring.go` | Health checks, uptime |
| `metrics.go` | Prometheus exposition |
| `explorer.go` | Blockchain explorer API |
| `system.go` | System-level operations |

#### Admin
| File | Responsibility |
|---|---|
| `admin_extended.go` | Extended admin operations |
| `admin_payouts.go` | Manual payout execution |
| `cli_distribution.go` | CLI binary distribution endpoint |
| `sdks.go` | SDK distribution |

### Data Models (30+ structs)

#### Core User Domain
```go
// User profile synced from Supabase auth
type User struct {
    ID           uuid.UUID
    Email        string
    Role         string   // buyer, provider, admin
    TrustTier    string   // new, verified, premium
    WalletAddress string
    // Social fields: bio, avatar, badges, etc.
}

// SOL-only wallet per user
type Wallet struct {
    UserID          uuid.UUID
    BalanceLamports int64     // SOL in lamports
    SpendingLimits  SpendingLimit
    LockedBalance   int64     // Funds in active escrow
}

// Immutable transaction journal
type WalletLedgerEntry struct {
    WalletID    uuid.UUID
    Type        string // topup, usage, payout, refund, transfer
    AmountSOL   float64
    Description string
    CreatedAt   time.Time
}
```

#### Marketplace Domain
```go
type ProxyListing struct {
    ProviderID   uuid.UUID
    PricePerGB   float64   // SOL
    GeoLocation  string
    ISP          string
    RoutingType  string    // datacenter, residential, mobile
    Bandwidth    int64     // bytes available
    IsActive     bool
}

type Order struct {
    BuyerID     uuid.UUID
    SellerID    uuid.UUID
    ListingID   uuid.UUID
    AmountSOL   float64
    Status      string  // pending, active, completed, disputed
    EscrowTxSig string  // Solana transaction signature
}

type Session struct {
    OrderID     uuid.UUID
    UserID      uuid.UUID
    Credentials SessionCredentials
    Type        string  // rotating, sticky
    BytesUsed   int64
    Status      string  // active, terminated, expired
    DeletedAt   *time.Time  // soft-delete for audit
}
```

#### Finance Domain
```go
type EscrowTransaction struct {
    OrderID       uuid.UUID
    BuyerAddr     string
    SellerAddr    string
    AmountLamports int64
    Status        string   // locked, released, refunded, disputed
    Milestones    []EscrowMilestone
}

type EscrowMilestone struct {
    EscrowID       uuid.UUID
    ByteThreshold  int64    // release when N bytes delivered
    ReleasePct     float64  // % of funds to release
    Status         string   // pending, triggered, released
}

type BatchPayoutItem struct {
    ProviderID    uuid.UUID
    Amount        float64
    Status        string  // pending, processing, completed, failed
    RetryCount    int
}
```

### Background Workers

```
workers/
├── escrow_listener.go     → Monitors Solana escrow state changes
├── tier_evaluator.go      → Recalculates provider trust tiers
├── escrow_cleaner.go      → Removes stale/expired escrows
├── settlement_worker.go   → Phase 14 aggregated settlement
├── marketplace_watcher.go → Real-time telemetry dashboard
├── zk_settlement_worker.go→ ZK proof processing
├── agent_worker.go        → AI agent task execution
└── agent_dispatcher.go    → Work distribution
```

### Startup Initialization Flow (main.go)

```
1. Load environment config
2. Connect PostgreSQL + run migrations
3. Connect Redis
4. Initialize ConfigManager (DB + Redis sync)
5. Load AdminConfig (hardcoded admin accounts)
6. Initialize Solana Oracle client
7. Initialize Multi-Sig Oracle (3-of-5)
8. Start Treasury Auto-Topup monitor
9. Start Blockchain Event Watcher
10. Start Session Activator
11. Register all HTTP routes (public / protected / admin)
12. Start Background Workers:
    - blockchain indexer
    - node sync service
    - escrow cleaner
    - settlement aggregator
    - marketplace watcher
    - provisioning worker
    - AI agent worker
    - provider tier evaluator
13. Start Gin HTTP server
```

---

## 4. Rust Backend — Edge Gateway

### Technology Stack

| Component | Library/Version |
|---|---|
| Language | Rust 1.85 |
| HTTP | Hyper 1.3 (HTTP/1 + HTTP/2) |
| Async Runtime | Tokio 1.37 |
| TLS | Rustls 0.23 + ring |
| Serialization | Serde / Serde_JSON |
| Metrics | Prometheus 0.13 |
| Tracing | tracing 0.1 |
| Database | Redis (deadpool-redis 0.15) |
| Protobuf | tonic / prost (gRPC to blockchain) |

### Module Structure

```
services/edge-gateway/src/
├── main.rs              # Server bootstrap, routing, CONNECT handling
├── auth.rs              # Proxy-Authorization header parsing, session verify
├── config.rs            # Config loading from env/files
├── control_api.rs       # HTTP client to control-api
├── error.rs             # Typed error variants
├── state.rs             # AppState (shared across tasks)
├── metrics.rs           # Prometheus counters/histograms
├── heartbeat.rs         # Provider heartbeat pings
├── circuitbreaker.rs    # Resilience patterns
├── policy.rs            # Access control (ACLs, domain filters)
├── tunnel.rs            # TCP tunnel for HTTPS CONNECT
├── tls.rs               # TLS config management
├── redis_pool.rs        # Redis connection pool
├── registry/
│   └── store.rs         # Provider registry with TTL cache
├── blockchain/          # Direct blockchain gRPC
├── pricing/             # Real-time pricing awareness
├── security/            # DDoS, geo-block, bot detection
│   ├── ddos.rs
│   ├── geoblock.rs
│   └── botdetect.rs
├── pool/                # Connection pooling
├── proxy/               # HTTP/HTTP2/WebSocket proxy
│   ├── http.rs
│   ├── http2.rs
│   └── websocket.rs
├── qos.rs               # Quality-of-Service enforcement
├── routing.rs           # Multi-region routing
├── leader.rs            # Leader election
└── metering.rs          # Byte-level usage metering
```

### Proxy Request Processing Pipeline

```
Incoming TCP Connection (Port 3128)
         │
         ▼
┌─────────────────────────┐
│  Parse HTTP Method      │
│  CONNECT = Tunnel       │
│  GET/POST = HTTP Proxy  │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  DDoS Rate Check        │  Token bucket per IP
│  Soft block → challenge │  Hard block → 429
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Geo-Block Check        │  MaxMind GeoLite2
│  Country/IP deny list   │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Bot Detection          │  UA fingerprint
│  Header order analysis  │  JA3 fingerprint
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Session Authentication │  Proxy-Authorization header
│  Verify via Redis cache │  or Control API call
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Policy Enforcement     │  ACLs, domain filtering
│  QoS enforcement        │  bandwidth throttle
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Multi-Region Routing   │  Choose best upstream
│  Circuit Breaker        │  Failover on error
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Metering               │  Track bytes for billing
│  Prometheus metrics     │
└──────────┬──────────────┘
           │
           ▼
  Backend Server (Target)
```

### Key Security Features

1. **Geo-blocking** — MaxMind GeoLite2 database integration, blocks by country code
2. **DDoS Protection** — Token bucket algorithm, soft (challenge) vs. hard (block) modes
3. **Bot Detection** — User-Agent classification, HTTP header order fingerprinting, JA3 TLS fingerprinting
4. **Circuit Breaker** — Protects against cascading failures to upstream services
5. **TLS** — Rustls (no OpenSSL), supports mutual TLS for provider connections

### Performance Design

- **Zero-copy I/O** via Tokio + Hyper
- **Connection pooling** for upstream connections
- **HTTP/2 multiplexing** for high-concurrency scenarios
- **WebSocket upgrade** support for tunneled WebSocket connections
- **Deadpool Redis** for non-blocking connection reuse

---

## 5. Frontend — Web Application

### Technology Stack

| Component | Library/Version |
|---|---|
| Framework | Next.js 16.1.1 (App Router) |
| Runtime | React 19.2.3 |
| Styling | Tailwind CSS 4 + tailwind-merge |
| State | Zustand 5.0.10 |
| Data Fetching | TanStack React Query 5.90 |
| Blockchain | @solana/web3.js 1.98 |
| Wallet | @solana/wallet-adapter + wagmi + RainbowKit |
| Charts | Recharts 3.7.0 |
| UI | Radix UI + Lucide icons |
| Testing | Playwright (E2E) |

### Application Structure

```
apps/web/src/
├── app/
│   ├── page.tsx                   # Landing/hero page
│   ├── auth/                      # Auth flow
│   ├── login/                     # Login page
│   ├── register/                  # Registration
│   ├── dashboard/
│   │   ├── proxy/                 # Session management
│   │   ├── wallet/                # SOL wallet
│   │   ├── nodes/                 # Provider node mgmt
│   │   ├── sessions/              # Active sessions
│   │   ├── usage/                 # Bandwidth analytics
│   │   ├── earnings/              # Provider earnings
│   │   ├── provider/              # Provider dashboard
│   │   │   ├── analytics/         # Provider analytics
│   │   │   └── services/          # Service management
│   │   ├── security/              # Security settings
│   │   └── messages/              # Direct messaging
│   ├── explorer/
│   │   ├── page.tsx               # Explorer home
│   │   ├── nodes/                 # Node explorer
│   │   ├── transactions/          # Transaction explorer
│   │   ├── blocks/[number]/       # Block detail
│   │   ├── health/                # Network health
│   │   ├── leaderboard/           # Provider rankings
│   │   ├── analytics/             # Network analytics
│   │   ├── sessions/              # Session explorer
│   │   ├── earnings/              # Earnings explorer
│   │   ├── search/                # Global search
│   │   └── map/                   # Geographic node map
│   ├── marketplace/               # Proxy listings browse
│   ├── profile/                   # User profiles
│   ├── forum/                     # Discussion forum
│   ├── governance/                # Voting system
│   ├── friends/                   # Friend management
│   └── settings/                  # User preferences
├── components/
│   ├── Sidebar.tsx                # Dashboard nav
│   ├── Navbar.tsx                 # Top nav
│   ├── SolanaWalletButton.tsx     # Wallet connect
│   ├── SessionLiveCard.tsx        # Real-time session card
│   ├── ListingCard.tsx            # Marketplace item
│   ├── SmartMatchWidget.tsx       # Intelligent matching UI
│   ├── SmartConnectWizard.tsx     # Onboarding wizard
│   ├── NotificationCenter.tsx     # Push notifications
│   ├── ProviderTierBadge.tsx      # Trust badge
│   ├── PerformanceHeatmap.tsx     # Geo heatmap
│   ├── ErrorBoundary.tsx          # Error containment
│   └── Accessibility.tsx          # A11y utilities
├── lib/
│   ├── auth.tsx                   # Supabase auth context
│   ├── api/
│   │   ├── index.ts               # Base API client
│   │   ├── wallet.ts              # Wallet API
│   │   ├── provider.ts            # Provider API
│   │   ├── forum-api.ts           # Forum API
│   │   ├── friends-api.ts         # Friends API
│   │   └── notifications-api.ts   # Notifications API
│   ├── services/
│   │   ├── explorer.ts            # Blockchain explorer
│   │   └── wallet.ts              # Wallet service layer
│   ├── solana.ts                  # Solana utilities
│   ├── web3-provider.tsx          # Wagmi + RainbowKit
│   └── websocket.tsx              # WebSocket manager
└── providers/
    └── QueryProvider.tsx          # React Query setup
```

### Key Frontend Patterns

1. **React Query** — All API calls go through `useQuery`/`useMutation` for caching, retries, and background refetch
2. **Zustand** — Lightweight global state for auth, wallet, and UI state
3. **Server Components** — Next.js App Router with selective `"use client"` components
4. **WebSocket** — Real-time session status, notifications via custom WebSocket hook
5. **Solana Wallet Adapter** — Supports Phantom, Backpack, Solflare, and hardware wallets

---

## 6. Database Architecture

### Schema Overview

The database uses **PostgreSQL 16** hosted via Supabase. User identity is managed by Supabase Auth (`auth.users`) with a trigger-synchronized `profiles` table.

### Core Tables

```
auth.users              → Supabase-managed identity
profiles                → User profile data (synced via DB trigger)
wallets                 → SOL balance per user
wallet_ledger_entries   → Immutable transaction journal
spending_limits         → Per-user daily/weekly/monthly caps

nodes                   → Provider proxy nodes (heartbeat-updated)
proxy_listings          → Provider bandwidth offerings
orders                  → Purchase transactions
sessions                → Active proxy sessions (soft-deleteable)
escrow_transactions     → Funds locked during order
escrow_milestones       → Granular escrow release triggers
disputes                → Buyer-seller conflicts
reviews                 → Provider ratings

forum_categories        → Forum categorization
forum_threads           → Thread headers
forum_posts             → Post content
forum_votes             → Vote tallies

friendships             → Bidirectional friend edges
friend_requests         → Pending requests
messages                → Message content
conversations           → Message threads

proposals               → Governance proposals
votes                   → On-chain vote records

badges                  → Achievement definitions
user_badges             → User-achievement join

audit_logs              → All significant actions (partitioned)
payout_retry_queue      → Failed payment recovery
batch_payout_items      → Pending batch payouts
provider_tokens         → CLI/API authentication tokens
system_configurations   → Runtime config key-value store
```

### Migration History

| Migration | Purpose |
|---|---|
| `000001_init_supabase` | Core tables, auth triggers, basic schema |
| `000002_consensus_tables` | Consensus/voting initial tables |
| `000003_wallet_multi_currency` | Multi-currency (superseded by SOL-only) |
| `000004_performance_indexes` | Query optimization indexes |
| `000005_provider_tiers` | Trust tier system |
| `000006_social_features` | Forums, friends, messaging |
| `000007+` | Forum cleanup, admin tables, soft deletes |
| `000008_audit_log` | Partitioned audit logging |
| `000028_spending_limits` | Per-user SOL spending caps |
| `000029_batch_payouts` | Batch payout queue table |
| `20260314_sol_only_migration` | Remove multi-currency, enforce SOL-only |
| `20260315_add_provider_tokens` | Provider API token table |

### Index Strategy

- Primary keys on all tables (UUID)
- Foreign key indexes (UserID, OrderID, SessionID)
- Composite indexes on frequently filtered columns
- Partial indexes for soft-deleted records (`WHERE deleted_at IS NULL`)
- Audit log table is **range-partitioned by month** for performance at scale

---

## 7. Docker & Infrastructure

### Docker Compose Configuration

#### Development (`docker-compose.yml`)

```yaml
services:
  control-api:     Port 8081  | Go backend          | Depends: postgres, redis, nats
  edge-gateway:    Port 3128  | Rust proxy           | Depends: control-api
                   Port 8090  | Gateway metrics
  web:             Port 3000  | Next.js frontend     | Depends: control-api
  admin:           Port 3002  | Admin dashboard      | Depends: control-api
  postgres:        Port 5432  | PostgreSQL 16-alpine | Health: pg_isready
  redis:           Port 6379  | Redis 7-alpine       | AOF persistence
  nats:            Port 4222  | NATS 2.10 JetStream  | Monitoring: 8222
  prometheus:      Port 9091  | Prometheus           | 200h retention
  grafana:         Port 3001  | Grafana 10.2.0       | Pre-configured dashboards
  redis-exporter:  Port 9121  | Redis metrics
```

#### Production (`docker-compose.prod.yml`)

- Uses pre-built images (`proxyhubb/control-api:latest`, etc.)
- `GIN_MODE=release` for backend (disables debug output)
- Production-grade environment variables
- No exposed debug ports
- Read-only oracle keypair volume

#### Testing (`docker-compose.test.yml`)

- Ephemeral service instances for CI
- Isolated network for test runs

### Dockerfile Analysis

#### Control API (`services/control-api/Dockerfile`)
```dockerfile
# Stage 1: Build
FROM golang:1.24-alpine AS builder
RUN go build -ldflags="-w -s" -o /app/control-api .

# Stage 2: Runtime
FROM alpine:3.20
RUN adduser -D appuser
COPY --from=builder /app/control-api .
USER appuser
HEALTHCHECK --interval=30s CMD wget -q -O- http://localhost:8080/health
```

**Observations:**
- Multi-stage build (correct — minimizes final image size)
- Non-root execution (`appuser`) — security best practice
- Alpine base — minimal attack surface
- Health check registered with Docker

#### Edge Gateway (`services/edge-gateway/Dockerfile`)
```dockerfile
# Stage 1: Build
FROM rust:1.85-alpine AS builder
RUN apk add musl-dev openssl-dev pkgconfig
RUN cargo build --release [--features ml]

# Stage 2: Runtime
FROM alpine:3.20
COPY --from=builder /app/target/release/edge-gateway .
USER nobody
```

**Observations:**
- Static linking with musl — portable binary
- Optional ML feature (`--features ml` for ONNX inference)
- Protobuf compiled at build time via `build.rs`
- Non-root user (`nobody`)

#### Web Frontend (`apps/web/Dockerfile`)
```dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS deps
RUN npm ci --only=production

# Stage 2: Build
FROM node:20-alpine AS builder
RUN npm run build

# Stage 3: Runtime
FROM node:20-alpine AS runner
USER nextjs
```

**Observations:**
- Three-stage build (deps → build → runtime)
- `NODE_ENV=production` in final stage
- Non-root user for execution
- `next.config.js` rewrites baked in to avoid CORS

### Network Topology

```
docker network: proxyhubb_default (bridge)
  - All services communicate via service name DNS
  - External ports only exposed where necessary
  - Proxy port 3128 is the primary public ingress
  - Control API 8081 is semi-public (should be behind nginx in prod)
```

### Volume Management

| Volume | Contents | Persistence |
|---|---|---|
| `postgres_data` | All database files | Persistent |
| `redis_data` | Cache + AOF log | Persistent |
| `grafana_data` | Dashboard configs | Persistent |
| `./oracle-keypair.json` | Solana oracle private key | Host mount |
| `./certs/` | TLS certificates | Host mount |

---

## 8. Solana Blockchain Integration

### Architecture

```
Control API
    │
    ├── solana/client.go          # Multi-endpoint RPC client
    │   ├── Primary RPC
    │   ├── Secondary RPC (failover)
    │   └── Tertiary RPC (failover)
    │
    ├── solana/settlement.go      # Settlement processing
    │   └── single + batch transfers
    │
    ├── solana/verify.go          # Transaction verification
    │   └── Signature + confirmation checks
    │
    ├── treasury/treasury_manager.go  # Auto-topup
    │   ├── Balance monitoring (5 min interval)
    │   ├── Threshold-based triggers
    │   └── Velocity monitoring
    │
    └── billing/batch_payout.go   # Batch SOL payouts
        ├── Queue management
        ├── Gas optimization
        └── Retry logic
```

### Multi-Endpoint Failover

```go
endpoints := []string{
    primaryRPC,   // Fastest, lowest latency
    secondaryRPC, // Fallback
    tertiaryRPC,  // Last resort (e.g., public node)
}
// Automatic failover with exponential backoff
```

### Multi-Sig Oracle Security

For transfers exceeding **1 SOL** threshold:
- Requires **3-of-5 oracle signatures**
- Each oracle instance independently validates
- Transaction only submitted when quorum reached
- Prevents single-key compromise from draining treasury

### Treasury Auto-Topup Thresholds

| Network | Minimum | Target | Action |
|---|---|---|---|
| DevNet | 5 SOL | 20 SOL | Auto-topup from reserve |
| MainNet | 100 SOL | 500 SOL | Auto-topup + alert |

### Escrow Flow

```
1. Buyer creates Order
         ↓
2. Buyer locks SOL in Escrow Account (Solana program)
         ↓
3. Session provisioned with bandwidth limit
         ↓
4. Provider delivers bandwidth via Edge Gateway
         ↓
5. Edge Gateway meters bytes → Redis
         ↓
6. Milestone triggers:
   - 25% bandwidth used → Release 25% funds
   - 50% bandwidth used → Release 25% funds
   - 100% bandwidth used → Release remaining 50%
         ↓
7. Auto-release after time limit OR manual release
         ↓
8. Settled SOL credited to provider wallet
         ↓
9. Provider accrual → Batch payout queue
         ↓
10. Batch Solana transfer executed
```

---

## 9. Security Architecture

### Authentication Chain

```
Incoming Request
       │
       ▼
┌──────────────────────────┐
│ 1. Parse Authorization   │
│    header                │
└──────────┬───────────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
Local JWT    Provider Token
(Wallet)     (CLI/API Key)
    │             │
    ▼             ▼
Verify sig   Lookup in DB
    │             │
    └──────┬──────┘
           │ (fallback)
           ▼
    Supabase API
    (circuit-broken,
     cached 5 min)
           │
           ▼
  Extract: UserID, Role,
  Email, TrustTier
           │
           ▼
  gin.Context.Set(...)
           │
           ▼
  Route Handler
```

### Security Middleware Stack

| Middleware | Function |
|---|---|
| `EmergencyBreaker()` | Kill switch — disables all non-admin routes during incidents |
| `WAFMiddleware()` | IP whitelist, path validation, SQL injection signatures |
| `DDoSProtectionMiddleware()` | Token bucket rate limiting, challenge tokens |
| `CircuitBreakerMiddleware()` | Per-dependency breakers (DB, Redis, Solana, Supabase) |
| `TracingMiddleware()` | OpenTelemetry distributed traces |
| `MetricsMiddleware()` | Prometheus request counters |

### Spending Limits (Financial Security)

| Tier | Daily | Weekly | Monthly |
|---|---|---|---|
| New | 10 SOL | 50 SOL | 100 SOL |
| Verified | 50 SOL | 200 SOL | 500 SOL |
| Premium | 100 SOL | 500 SOL | 2000 SOL |

Limits apply to: usage charges, P2P transfers, SOL withdrawals.

### DDoS Mitigation (Edge Gateway)

1. **Token Bucket** — Per-IP rate limiting (configurable RPS)
2. **Soft Block** — Issue challenge token, proceed with low priority bandwidth
3. **Hard Block** — HTTP 429, temporary IP ban
4. **Geo-Block** — Country-level allow/deny lists
5. **Bot Detection** — UA fingerprinting, header order analysis, JA3 classification
6. **Reputation System** — Track historical violations, decay over time

---

## 10. Billing & Settlement System

### Architecture Flow

```
Session Active
    │
    ▼
Edge Gateway meters bytes
    │
    ▼
Redis: billing:session:{id}:pending += bytes
    │
    ▼ (every 1 hour)
Settlement Worker:
  1. Scan all active sessions
  2. Read pending bytes from Redis
  3. Calculate cost: GB × pricePerGB = SOL
  4. Deduct from buyer wallet (with spending limit check)
  5. Accrue to provider wallet
  6. Write WalletLedgerEntry (buyer debit)
  7. Write WalletLedgerEntry (provider credit)
    │
    ▼
Provider accrual >= 0.05 SOL threshold?
    │ Yes
    ▼
BatchPayoutItem created
    │
    ▼ (every 15 minutes)
Batch Payout Processor:
  - Group items by status=pending
  - Immediate: amount > 10 SOL → skip queue
  - Batch: wait for min 5 items OR 30 min timeout
  - Submit: up to 20 items per Solana transaction
  - Retry: exponential backoff for failures
    │
    ▼
Solana transfer executed
    │
    ▼
LedgerEntry: payout confirmed
```

### Batch Payout Optimization

| Parameter | Value | Rationale |
|---|---|---|
| Immediate threshold | 10 SOL | Large payouts bypass queue |
| Max batch size | 20 items | Solana tx size limit |
| Min batch size | 5 items | Wait for efficiency |
| Max wait time | 30 min | Guaranteed SLA |
| Process interval | 15 min | Frequent enough for latency |
| Gas savings | ~30% | vs individual transactions |

### Failed Payout Recovery

1. Failed transfers written to `payout_retry_queue`
2. Exponential backoff: 1m → 5m → 15m → 1h
3. After max retries: flag for manual review
4. Admin endpoint: `/admin/payouts/retry`

---

## 11. Provider CLI Tool

### Overview

The Provider CLI (`cmd/provider-cli`) is a Go binary distributed to proxy node operators. It authenticates via Provider Tokens (long-lived API keys) and manages node registration, service configuration, and diagnostics.

### Commands

| Command | Purpose |
|---|---|
| `node register` | Register a new proxy node |
| `node list` | List registered nodes |
| `node heartbeat` | Send liveness ping |
| `service start` | Start proxy service |
| `service stop` | Stop proxy service |
| `service status` | View service status |
| `doctor` | Health diagnostic scan |
| `wizard` | Interactive setup wizard |
| `version` | Print version info |

### Authentication Model

```
~/.proxyhubb/
├── config.yaml          # API endpoint, preferences
└── token                # Long-lived provider token

Request → Authorization: Bearer <provider_token>
         ↓
middleware/provider_token_auth.go
         ↓
DB lookup: provider_tokens table
         ↓
Set: UserID, ProviderID, scopes
```

### CLI Distribution

The API serves CLI binaries via `/api/v1/cli/download` endpoint, supporting version-pinned downloads. Binaries are stored in `./cli-dist/` (mounted as Docker volume).

---

## 12. Observability & Monitoring

### Metrics Architecture

```
Control API → /metrics (Prometheus format)
Edge Gateway → /metrics (Prometheus format)
Redis Exporter → /metrics
         │
         ▼
Prometheus (scrapes all targets)
         │
         ▼
Grafana (visualizes dashboards)
```

### Application Metrics Collected

**Control API:**
- `http_requests_total{method, endpoint, status}` — Request counters
- `http_request_duration_seconds` — Latency histograms
- `db_query_duration_seconds` — Database performance
- `redis_operations_total` — Cache operations
- `solana_rpc_duration_seconds` — Blockchain latency
- `circuit_breaker_state{service}` — Dependency health
- `sessions_active` — Live proxy session count
- `bandwidth_sold_bytes_total` — Business metric
- `revenue_sol_total` — Revenue metric

**Edge Gateway:**
- `proxy_requests_total{method, status}` — Proxy request counts
- `proxy_bytes_total{direction}` — Data transferred
- `ddos_blocks_total{type}` — Security events
- `auth_failures_total` — Failed auth attempts
- `circuit_breaker_trips_total` — Upstream failures

### Distributed Tracing

- **Library:** OpenTelemetry (Go + Rust)
- **Export:** Jaeger or OTLP endpoint
- **Sampling:** 100% development, 10% production
- **Spans:** HTTP requests, DB queries, Solana calls, cache operations
- **Correlation:** Trace IDs propagated via HTTP headers

### Log Strategy

```
Level    | Dev  | Prod
---------|------|------
DEBUG    | Yes  | No
INFO     | Yes  | Yes
WARN     | Yes  | Yes
ERROR    | Yes  | Yes

Format: JSON (structured) in production
Fields: timestamp, level, service, traceID, userID, endpoint, duration, error
```

### Grafana Dashboards (Pre-configured)

1. **ProxyHub Overview** — TPS, uptime, error rate, active sessions
2. **User Metrics** — Signups, DAU, MAU, churn
3. **Provider Analytics** — Earnings, tier distribution, node health
4. **Infrastructure** — CPU, memory, disk, network per container
5. **Blockchain** — Solana RPC latency, settlement queue depth, treasury balance

---

## 13. Testing Infrastructure

### Backend Tests

| File | Tests |
|---|---|
| `wallet_test.go` | Wallet creation, balance, spending limits |
| `session_test.go` | Session lifecycle, credential generation |
| `smart_matching_test.go` | Matching algorithm correctness |
| `analytics_test.go` | Analytics aggregation |
| `concurrency_test.go` | Race condition detection |
| `orders_test.go` | Order creation, escrow locking |
| `forums_test.go` | Forum CRUD |
| `friends_test.go` | Social graph operations |
| `messaging_test.go` | Message delivery |

### Test Utilities (`internal/testutil/testutil.go`)

```go
// Provides:
- SetupTestDB()     → In-memory SQLite or test PostgreSQL
- MockSolanaClient  → Stub blockchain calls
- CreateTestUser()  → Factory for test users
- CreateTestOrder() → Factory for test orders
```

### Frontend Tests (Playwright E2E)

| File | Coverage |
|---|---|
| `app.spec.ts` | Basic app load, navigation |
| `auth.spec.ts` | Login, registration, wallet connect |
| `features.spec.ts` | Feature smoke tests |
| `forum.spec.ts` | Forum posting, voting |
| `friends.spec.ts` | Friend requests, accept/deny |
| `messaging.spec.ts` | Direct message send/receive |
| `notifications.spec.ts` | Notification delivery |
| `accessibility.spec.ts` | WCAG 2.1 compliance checks |

### Test Gaps Identified

- No integration tests for Solana escrow flows (mocked entirely)
- Edge Gateway (Rust) has limited test coverage (`cargo test`)
- No load/performance tests
- No chaos engineering tests for circuit breaker validation

---

## 14. CI/CD Pipeline

### Workflow Files

#### `.github/workflows/ci.yml`

```yaml
jobs:
  backend:
    - Go 1.24 setup
    - PostgreSQL 15 service
    - Redis 7 service
    - NATS 2.10 service
    - go build ./...
    - go test ./...
    - golangci-lint

  frontend:
    - Node 20 setup
    - npm ci
    - npm run lint
    - npm run build
    - npx playwright test

  edge-gateway:
    - Rust stable setup
    - cargo fmt --check
    - cargo clippy
    - cargo test

  docker-build:
    - Build all Docker images
    - Push to registry on main branch
```

#### `.github/workflows/deploy.yml`

```yaml
- Trigger: push to main
- Build production images
- Tag with commit SHA + latest
- Push to container registry
```

#### `.github/workflows/security.yml`

```yaml
- SAST scanning (gosec for Go)
- Dependency vulnerability check
- Docker image scanning
- Secret detection (gitleaks)
```

---

## 15. Pros & Strengths

### Architecture Strengths

| # | Strength | Detail |
|---|---|---|
| 1 | **Microservice-ready design** | Services are independently deployable and scalable |
| 2 | **Language-appropriate selection** | Go for business logic (fast dev, good concurrency), Rust for the hot proxy path (zero-cost abstractions, memory safety) |
| 3 | **Security-first multi-layer approach** | WAF + DDoS + Geo-block + Bot detection + Circuit breaker + Spending limits |
| 4 | **Production-grade Solana integration** | Multi-endpoint failover, multi-sig oracle for large transfers, auto-topup treasury |
| 5 | **Phase-based roadmap** | 24 implemented/planned phases with clear feature progression |
| 6 | **Batch payout optimization** | ~30% gas savings vs. per-transfer Solana transactions |
| 7 | **Circuit breaker everywhere** | Protects each external dependency (DB, Redis, Solana, Supabase) |
| 8 | **Audit log partitioning** | Monthly partitions on `audit_logs` for long-term scalability |
| 9 | **Comprehensive observability** | Prometheus + Grafana + OpenTelemetry + structured zerolog |
| 10 | **Provider trust tier system** | Gamified trust progression incentivizes provider quality |

### Code Quality Strengths

| # | Strength | Detail |
|---|---|---|
| 1 | **Go module structure** | Clean separation into api/, models/, billing/, worker/, etc. |
| 2 | **Rust memory safety** | Edge gateway has zero memory-unsafe code by construction |
| 3 | **Typed error handling (Rust)** | Custom error types via `error.rs`, proper `Result<T, E>` propagation |
| 4 | **Soft-delete for audit trails** | Sessions retain history even after termination |
| 5 | **Spending limit enforcement** | Financial guardrails at the model layer (not just UI) |
| 6 | **Immutable ledger** | `wallet_ledger_entries` is append-only — correct financial design |
| 7 | **Provider tokens** | Separate auth path for CLI avoids sharing user credentials |
| 8 | **Config hot-reload** | Runtime config via `system_configurations` without restarts |
| 9 | **Milestone-based escrow** | Partial fund release based on delivery — protects both parties |
| 10 | **ZK reputation system** | Privacy-preserving trust without exposing raw transaction history |

### Infrastructure Strengths

| # | Strength | Detail |
|---|---|---|
| 1 | **Multi-stage Docker builds** | Minimal final image sizes (no build tools in production) |
| 2 | **Non-root containers** | All services run as non-root users |
| 3 | **Health checks** | All services have Docker health checks configured |
| 4 | **Redis AOF persistence** | Cache survives restarts — sessions not lost |
| 5 | **NATS JetStream** | At-least-once delivery for billing events |
| 6 | **Dev/Prod/Test compose split** | Clear environment separation |
| 7 | **Pre-configured Grafana** | Instant visibility without manual setup |
| 8 | **Oracle keypair isolation** | Solana private key is a host-mount volume, not baked into image |

---

## 16. Cons, Risks & Weaknesses

### Critical Risks

| # | Risk | Severity | Detail |
|---|---|---|---|
| 1 | **Oracle private key on host** | CRITICAL | `./oracle-keypair.json` is mounted as a Docker bind mount. If the host is compromised, all treasury SOL is at risk. Should use Vault, AWS KMS, or HSM. |
| 2 | **Admin credentials in docker-compose** | HIGH | Hardcoded admin accounts in compose files risk credential exposure via git history. Should use secrets management. |
| 3 | **Single database for all services** | HIGH | Control API and (via session cache) Edge Gateway share the same PostgreSQL instance. No read replicas. Single point of failure. |
| 4 | **No API rate limiting on Control API** | HIGH | DDoS protection exists only in Edge Gateway. The Control API has no per-IP rate limits — a determined attacker bypassing Edge Gateway could overwhelm it. |
| 5 | **Solana devnet only** | MEDIUM | The system is configured for devnet. Mainnet migration requires verifying all program IDs, treasury thresholds, and oracle configurations — high-risk transition. |

### Architecture Weaknesses

| # | Weakness | Severity | Detail |
|---|---|---|---|
| 1 | **No API versioning** | HIGH | All routes are unversioned (`/api/`). Breaking changes require all clients to update simultaneously. |
| 2 | **No read replicas** | MEDIUM | All read queries hit the primary PostgreSQL. For a marketplace with heavy read traffic, this bottlenecks scalability. |
| 3 | **In-memory rate limiting** | MEDIUM | Some rate limiting components are in-memory. In a multi-instance deployment, limits are per-instance, not global. Should be Redis-backed. |
| 4 | **Tight service coupling** | MEDIUM | Edge Gateway calls Control API synchronously for session verification. If Control API is slow, proxy latency suffers. Session cache helps but isn't perfect. |
| 5 | **Missing OpenAPI/Swagger** | MEDIUM | No API documentation generated from handlers. Frontend API clients are manually maintained. |
| 6 | **Complex multi-currency migration artifacts** | LOW | Migration `000003_wallet_multi_currency` was superseded by SOL-only. The old migration still runs, creating then abandoning columns. Adds cognitive overhead. |

### Code Quality Weaknesses

| # | Weakness | Severity | Detail |
|---|---|---|---|
| 1 | **Inconsistent error response format** | MEDIUM | Some handlers return `{"error": "..."}`, others return `{"message": "..."}`, others return raw strings. Frontend must handle all variants. |
| 2 | **Missing integration tests** | MEDIUM | Solana escrow flows are entirely mocked. Real-blockchain integration tests would catch RPC edge cases. |
| 3 | **Limited Rust test coverage** | MEDIUM | Edge Gateway has minimal `cargo test` coverage. Core proxy logic (DDoS, auth, metering) lacks unit tests. |
| 4 | **No load testing** | MEDIUM | No k6, Locust, or similar performance tests. Unknown throughput limits for proxy sessions or API calls. |
| 5 | **Large main.go** | LOW | `main.go` is 600+ lines. Startup logic could be split into initialization modules for readability. |
| 6 | **Documentation gaps** | LOW | Handler files have minimal comments. Function intent often requires reading the entire body. |
| 7 | **Orphaned migration columns** | LOW | SOL-only migration leaves `000003` multi-currency columns unused but schema-present. |

### Security Concerns

| # | Concern | Severity | Detail |
|---|---|---|---|
| 1 | **JWT secret in env only** | HIGH | If `JWT_SECRET` is rotated, all active sessions are invalidated with no graceful transition. No key versioning. |
| 2 | **Admin accounts in source** | HIGH | Admin accounts referenced in docker-compose are a credential leakage risk if repo is public or logs are exposed. |
| 3 | **No CSRF protection documented** | MEDIUM | The frontend uses cookie-based Supabase auth. CSRF protection mechanisms are not explicitly documented in the codebase. |
| 4 | **Oracle key rotation mechanism** | MEDIUM | No documented process for rotating the Solana oracle private key. A key compromise could require complex on-chain program migration. |
| 5 | **TLS certificate management** | MEDIUM | Certs are in `./certs/` host mount. No automated renewal (e.g., Let's Encrypt cert-manager). |
| 6 | **Bot detection evasion** | LOW | JA3 fingerprinting is noted as "partial, for future." Current bot detection (UA + header order) can be bypassed by sophisticated clients. |

### Operational Weaknesses

| # | Weakness | Severity | Detail |
|---|---|---|---|
| 1 | **No horizontal scaling documentation** | HIGH | Multi-instance Control API deployment would require distributed locks for settlement workers, leader election for indexers. Not documented. |
| 2 | **Database migration strategy** | MEDIUM | Migrations run on startup (`db.go`). Zero-downtime migrations for large tables (e.g., `wallet_ledger_entries`) are not addressed. |
| 3 | **Manual CLI distribution** | LOW | CLI binaries are served from `./cli-dist/` volume. No automated build-and-upload pipeline for new versions. |
| 4 | **No backup strategy documented** | MEDIUM | PostgreSQL and Redis persistence volumes exist but no documented backup/restore procedure. |

---

## 17. Recommendations

### Priority 1 — Critical (Address Immediately)

1. **Migrate oracle keypair to secrets manager** — Use HashiCorp Vault, AWS Secrets Manager, or GCP Secret Manager. Never store private keys as host-mounted files in production.

2. **Remove admin credentials from docker-compose** — Use Docker secrets or environment variable injection at deploy time. Rotate all currently committed credentials.

3. **Implement Control API rate limiting** — Add Redis-backed per-IP rate limiting middleware for the Control API (not just Edge Gateway). Use the `golang.org/x/time/rate` package or similar, backed by Redis for multi-instance deployments.

4. **Add PostgreSQL read replica** — For marketplace read traffic (listings, explorer), route queries to a read replica. Reduces primary load significantly.

### Priority 2 — High (Address in Next Sprint)

5. **Add API versioning** — Prefix all routes with `/api/v1/`. Create `/api/v2/` namespace for breaking changes. This is non-disruptive to add now before a public API launch.

6. **Standardize error response format** — Define a single error DTO:
   ```go
   type ErrorResponse struct {
       Code    string `json:"code"`
       Message string `json:"message"`
       Details any    `json:"details,omitempty"`
   }
   ```
   Apply consistently across all handlers.

7. **Add Redis-backed distributed rate limiting** — Replace any in-memory rate limiter components with Redis-backed equivalents to ensure correctness in multi-instance deployments.

8. **Implement JWT key rotation** — Support multiple valid signing keys with a `kid` header. Allow graceful rotation without session invalidation.

9. **Generate OpenAPI documentation** — Use `swaggo/swag` to generate Swagger docs from handler comments. Reduces frontend-backend drift.

### Priority 3 — Medium (Address in Next Quarter)

10. **Expand Rust Edge Gateway test coverage** — Write unit tests for auth, metering, DDoS, and policy modules. Target ≥70% coverage.

11. **Add load tests** — Implement k6 performance tests for:
    - Session creation throughput
    - Proxy request handling (target: 10,000 req/s)
    - Batch settlement processing

12. **Document horizontal scaling guide** — Document distributed lock requirements, leader election behavior, and worker deduplication for multi-instance deployments.

13. **Add database backup automation** — Implement pg_dump cron job with rotation. Integrate Redis BGSAVE snapshots. Document restore procedures.

14. **Clean up orphaned migration columns** — Add a clean-up migration to drop the `000003` multi-currency columns that are no longer used.

15. **Automate CLI binary distribution** — Add GitHub Actions workflow to build and upload CLI binaries to the distribution endpoint on each tagged release.

---

## 18. Component Summary Table

| Component | Language | Framework | Version | Port(s) | Status | Quality |
|---|---|---|---|---|---|---|
| **Control API** | Go | Gin + GORM | 1.24 | 8080/8081 | Production | Good |
| **Edge Gateway** | Rust | Hyper + Tokio | 1.85 | 3128/8090 | Production | Excellent |
| **Web Frontend** | TypeScript | Next.js 16 | React 19 | 3000 | Production | Good |
| **Admin Dashboard** | TypeScript | Next.js 16 | React 19 | 3002 | Production | Good |
| **PostgreSQL** | SQL | — | 16-alpine | 5432 | Production | Good |
| **Redis** | — | — | 7-alpine | 6379 | Production | Good |
| **NATS** | — | JetStream | 2.10 | 4222 | Production | Good |
| **Prometheus** | — | — | 2.x | 9091 | Production | Good |
| **Grafana** | — | — | 10.2.0 | 3001 | Production | Good |
| **Solana** | Rust | solana-go | devnet | — | Pre-prod | Needs Review |
| **Provider CLI** | Go | Cobra | 1.24 | N/A | Beta | Fair |

---

## Appendix A — Environment Variable Reference

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | control-api | PostgreSQL connection string |
| `REDIS_URL` | control-api, edge-gateway | Redis connection |
| `NATS_URL` | control-api | NATS JetStream endpoint |
| `JWT_SECRET` | control-api | Local JWT signing key |
| `SESSION_SECRET` | control-api | Session encryption |
| `ADMIN_JWT_SECRET` | control-api | Admin-only JWT signing |
| `SUPABASE_URL` | control-api, web | Supabase project URL |
| `SUPABASE_ANON_KEY` | web | Public Supabase key |
| `SUPABASE_SERVICE_KEY` | control-api | Private Supabase admin key |
| `SOLANA_RPC_ENDPOINT` | control-api | Primary Solana RPC |
| `SOLANA_NETWORK` | control-api | devnet / mainnet-beta |
| `SOLANA_PROGRAM_ID` | control-api | Escrow program address |
| `SOLANA_TREASURY_ADDRESS` | control-api | Treasury wallet pubkey |
| `ORACLE_PRIVATE_KEY` | control-api | Oracle signing key (CRITICAL) |
| `COINGECKO_API_KEY` | control-api | SOL price feeds |
| `NEXT_PUBLIC_API_URL` | web | Frontend → API URL |
| `NEXT_PUBLIC_WS_URL` | web | Frontend → WebSocket URL |
| `GIN_MODE` | control-api | debug / release |

---

## Appendix B — Port Reference

| Port | Service | Protocol | Access |
|---|---|---|---|
| 3000 | Web UI | HTTP | Public |
| 3001 | Grafana | HTTP | Internal |
| 3002 | Admin UI | HTTP | Restricted |
| 3128 | Edge Gateway (Proxy) | SOCKS5/HTTP | Public |
| 4222 | NATS | TCP | Internal |
| 5432 | PostgreSQL | TCP | Internal |
| 6379 | Redis | TCP | Internal |
| 8080 | Control API | HTTP | Internal |
| 8081 | Control API | HTTP | Semi-public |
| 8090 | Edge Gateway Metrics | HTTP | Internal |
| 8222 | NATS Monitor | HTTP | Internal |
| 9091 | Prometheus | HTTP | Internal |
| 9121 | Redis Exporter | HTTP | Internal |

---

*Report generated: 2026-03-16*
*Analyst: Claude Sonnet 4.6 — Expert Systems Review*
*Codebase: f:/project/proxyhubb*
