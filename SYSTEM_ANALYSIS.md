# ProxyHubb — Comprehensive System Analysis Report

> **Date:** 2026-03-30
> **Scope:** Full codebase analysis — all engines, services, subsystems, and architecture
> **Status:** Review Draft

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
   - 2.1 [Full Architecture Diagram](#21-full-architecture-diagram)
   - 2.2 [Service Communication Map](#22-service-communication-map)
   - 2.3 [Startup & Dependency Chain](#23-startup--dependency-chain)
3. [Subsystems Deep Dive](#3-subsystems-deep-dive)
   - 3.1 [Control API — Core Orchestrator (Go)](#31-control-api--core-orchestrator-go)
   - 3.2 [Edge Gateway Engine (Rust)](#32-edge-gateway-engine-rust)
   - 3.3 [Proxy Gateway & Pool Engine](#33-proxy-gateway--pool-engine)
   - 3.4 [Provider Node Daemon (Rust)](#34-provider-node-daemon-rust)
   - 3.5 [Blockchain Engine (Solana + Anchor)](#35-blockchain-engine-solana--anchor)
   - 3.6 [Financial Engine](#36-financial-engine)
   - 3.7 [Social Services](#37-social-services)
   - 3.8 [Proxy Explorer](#38-proxy-explorer)
   - 3.9 [Database System](#39-database-system)
   - 3.10 [Admin CLI & Admin Panel](#310-admin-cli--admin-panel)
   - 3.11 [Web Frontend (Next.js)](#311-web-frontend-nextjs)
   - 3.12 [Relayer Service (Go)](#312-relayer-service-go)
4. [Data Flow Diagrams](#4-data-flow-diagrams)
   - 4.1 [Consumer Proxy Usage Flow](#41-consumer-proxy-usage-flow)
   - 4.2 [Provider Earnings Flow](#42-provider-earnings-flow)
   - 4.3 [Escrow Payment Lifecycle](#43-escrow-payment-lifecycle)
   - 4.4 [Database Entity Relationship Overview](#44-database-entity-relationship-overview)
5. [Strengths & Pros](#5-strengths--pros)
6. [Issues & Cons Found](#6-issues--cons-found)
   - 6.1 [Critical Issues](#61-critical-issues)
   - 6.2 [High Severity Issues](#62-high-severity-issues)
   - 6.3 [Medium Severity Issues](#63-medium-severity-issues)
   - 6.4 [Low Severity Issues](#64-low-severity-issues)
7. [Recommendations & Implementation Plan](#7-recommendations--implementation-plan)
   - Phase 1: Critical Fixes
   - Phase 2: Security Hardening
   - Phase 3: Data Integrity
   - Phase 4: Robustness
   - Phase 5: Feature Completion
8. [Conclusion](#8-conclusion)

---

## 1. Executive Summary

**ProxyHubb** is a decentralized, peer-to-peer bandwidth marketplace that enables individuals and businesses to monetize their internet connections (providers) and purchase residential/mobile/fiber proxy bandwidth (consumers). The platform combines a high-performance proxy infrastructure with Solana blockchain-based payments, a social reputation layer, and a DAO governance system.

### What ProxyHubb Does

| Role | What They Do |
|------|-------------|
| **Provider** | Installs a lightweight daemon (`provider-node`), shares bandwidth, earns SOL per GB served |
| **Consumer** | Purchases proxy bandwidth via marketplace, uses SOCKS5/HTTP proxy on port 3128 |
| **Platform** | Routes consumer traffic through provider nodes, meters usage, handles escrow & payouts |

### Technology Stack at a Glance

| Layer | Technology | Language |
|-------|-----------|----------|
| Core API | Go 1.24 + Gin | Go |
| Proxy Engine | Tokio + Hyper | Rust |
| Provider Node | Tokio | Rust |
| Smart Contracts | Anchor (Solana) | Rust |
| Admin CLI | Clap | Rust |
| Web Frontend | Next.js 15 + App Router | TypeScript |
| Admin Panel | Next.js 15 | TypeScript |
| Blockchain Relayer | go-ethereum | Go |
| Database | PostgreSQL 16 | SQL |
| Cache | Redis 7 (AOF) | — |
| Message Bus | NATS 2.10 JetStream | — |
| Monitoring | Prometheus + Grafana | — |

### Scale Indicators

- **40+ API endpoint groups** in the Control API
- **50+ database tables** with Row-Level Security
- **9 Docker Compose configurations** for different deployment scenarios
- **4 major smart contract account types** on Solana
- **gRPC streaming** for real-time usage between Edge Gateway and blockchain layer
- **Multi-region ready** with leader election in the Edge Gateway

---

## 2. System Architecture

### 2.1 Full Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════════════════════════╗
║                           PROXYHUBB SYSTEM ARCHITECTURE                             ║
╠══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                      ║
║  ┌──────────────────────────────────────────────────────────────────────────────┐   ║
║  │                         EXTERNAL CLIENTS                                     │   ║
║  │   Browser (Consumer)      Proxy Client (SOCKS5/HTTP)     Provider CLI       │   ║
║  └──────────────────┬──────────────────────┬────────────────────────┬──────────┘   ║
║                     │ HTTPS :443           │ SOCKS5/HTTP :3128      │ HTTPS :8080  ║
║  ═══════════════════╪══════════════════════╪════════════════════════╪═════════════  ║
║                     ▼                      │                        │              ║
║  ┌──────────────────────────────┐          │                        │              ║
║  │       WEB FRONTEND           │          │                        │              ║
║  │   apps/web  (Next.js :3000)  │          │                        │              ║
║  │   apps/admin (Next.js :3002) │          │                        │              ║
║  └──────────────┬───────────────┘          │                        │              ║
║                 │ REST/WS :8080            │                        │              ║
║  ═══════════════╪══════════════════════════╪════════════════════════╪═════════════  ║
║                 ▼                          │                        ▼              ║
║  ┌─────────────────────────────────────────┼──────────────────────────────────┐   ║
║  │              CONTROL API  :8080          │   (Go + Gin)                     │   ║
║  │                                          │                                  │   ║
║  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ │ ┌──────────┐ ┌───────────────┐  │   ║
║  │  │   Auth   │ │  Users   │ │ Wallets  │ │ │  Orders  │ │   Escrow /    │  │   ║
║  │  │  /auth   │ │ /profile │ │ /wallet  │ │ │ /orders  │ │  Disputes     │  │   ║
║  │  └──────────┘ └──────────┘ └──────────┘ │ └──────────┘ └───────────────┘  │   ║
║  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ │ ┌──────────┐ ┌───────────────┐  │   ║
║  │  │Sessions  │ │ Circles  │ │Providers │ │ │ Explorer │ │  Governance   │  │   ║
║  │  │/sessions │ │/circles  │ │/providers│ │ │/explorer │ │ /governance   │  │   ║
║  │  └──────────┘ └──────────┘ └──────────┘ │ └──────────┘ └───────────────┘  │   ║
║  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ │ ┌──────────┐ ┌───────────────┐  │   ║
║  │  │Analytics │ │  Social  │ │ Agents   │ │ │   KYC    │ │    Admin      │  │   ║
║  │  │/analytics│ │ /social  │ │ /agents  │ │ │  /kyc    │ │   /admin      │  │   ║
║  │  └──────────┘ └──────────┘ └──────────┘ │ └──────────┘ └───────────────┘  │   ║
║  └─────────────────────────────────────────┼──────────────────────────────────┘   ║
║          │ PostgreSQL    │ Redis     │ NATS  │                                      ║
║          │ :5432         │ :6379     │ :4222 │                                      ║
║  ════════╪═══════════════╪═══════════╪═══════╪══════════════════════════════════    ║
║          ▼               ▼           ▼       ▼                                      ║
║  ┌───────────────┐ ┌──────────┐ ┌────────────────────────────────────────────┐    ║
║  │  PostgreSQL   │ │ Redis 7  │ │         NATS 2.10 JetStream :4222          │    ║
║  │   :5432       │ │ :6379    │ │   events: session.*, user.*, payment.*     │    ║
║  │  50+ tables   │ │ AOF+LRU  │ │   metrics: :8222                           │    ║
║  │  RLS enabled  │ │ 512MB    │ │                                            │    ║
║  └───────────────┘ └──────────┘ └────────────────────────────────────────────┘    ║
║  ═══════════════════════════════════════════════════════════════════════════════    ║
║                                                                                     ║
║  ┌────────────────────────────────────────────────────────────────────────────┐    ║
║  │              EDGE GATEWAY ENGINE  :3128 / :8090  (Rust + Tokio)           │    ║
║  │                                                                            │    ║
║  │  ┌──────────────┐ ┌─────────────┐ ┌──────────────┐ ┌────────────────┐   │    ║
║  │  │ SOCKS5/HTTP  │ │  Session    │ │   GeoIP      │ │  Billing /     │   │    ║
║  │  │  Tunnel      │ │  Cache      │ │  Filtering   │ │  Metering      │   │    ║
║  │  │  Port 3128   │ │  Redis+LRU  │ │  MaxMind     │ │  Ed25519 sig   │   │    ║
║  │  └──────────────┘ └─────────────┘ └──────────────┘ └────────────────┘   │    ║
║  │  ┌──────────────┐ ┌─────────────┐ ┌──────────────┐ ┌────────────────┐   │    ║
║  │  │  Load        │ │  Circuit    │ │  ML Routing  │ │  Prometheus    │   │    ║
║  │  │  Balancer    │ │  Breaker    │ │  (ONNX opt.) │ │  Metrics :8090 │   │    ║
║  │  └──────────────┘ └─────────────┘ └──────────────┘ └────────────────┘   │    ║
║  └──────────────────────────────────────────┬─────────────────────────────────┘   ║
║                                              │ Reverse Tunnel (Yamux)               ║
║  ════════════════════════════════════════════╪════════════════════════════════════  ║
║                       ┌──────────────────────┼──────────────────────┐              ║
║                        │                     │                       │              ║
║  ┌─────────────────────▼──┐ ┌───────────────▼──┐ ┌────────────────▼───┐          ║
║  │   PROVIDER NODE A       │ │  PROVIDER NODE B  │ │  PROVIDER NODE N   │          ║
║  │   (Rust Daemon)         │ │  (Rust Daemon)    │ │  (Rust Daemon)     │          ║
║  │   residential IP        │ │  mobile IP        │ │  fiber IP          │          ║
║  │   heartbeat 30s         │ │  heartbeat 30s    │ │  heartbeat 30s     │          ║
║  │   metrics :9090         │ │  metrics :9090    │ │  metrics :9090     │          ║
║  └────────────────────────┘ └──────────────────┘ └────────────────────┘          ║
║                                                                                     ║
║  ════════════════════════════════════════════════════════════════════════════════   ║
║                                                                                     ║
║  ┌──────────────────────────────────────────────────────────────────────────────┐  ║
║  │                    BLOCKCHAIN LAYER (Solana)                                 │  ║
║  │                                                                              │  ║
║  │  ┌────────────────────┐   ┌─────────────────────┐   ┌──────────────────┐   │  ║
║  │  │  Escrow Program    │   │  MultiSig Oracle     │   │  Treasury        │   │  ║
║  │  │  (Anchor/Rust)     │   │  3-of-5 threshold    │   │  Wallet          │   │  ║
║  │  │  Devnet/Mainnet    │   │  Velocity Guards     │   │  SOL payouts     │   │  ║
║  │  └────────────────────┘   └─────────────────────┘   └──────────────────┘   │  ║
║  │  Program ID: 2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7                 │  ║
║  └──────────────────────────────────────────────────────────────────────────────┘  ║
║                                                                                     ║
║  ════════════════════════════════════════════════════════════════════════════════   ║
║                                                                                     ║
║  ┌──────────────────────────────────────────────────────────────────────────────┐  ║
║  │                 MONITORING & OBSERVABILITY                                   │  ║
║  │                                                                              │  ║
║  │  Prometheus :9091 ──scrapes──► control-api:8080/metrics                    │  ║
║  │                  └──scrapes──► edge-gateway:8090/metrics                   │  ║
║  │                  └──scrapes──► redis-exporter:9121                         │  ║
║  │  Grafana :3001   ──queries──► Prometheus                                   │  ║
║  │  Jaeger (opt.)  ◄──traces───  OpenTelemetry (all services)                 │  ║
║  └──────────────────────────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════════════════════════╝
```

---

### 2.2 Service Communication Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     INTER-SERVICE COMMUNICATION                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Protocol        Direction                     Purpose                       │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  REST HTTP       Frontend → Control API        All user-facing operations    │
│  REST HTTP       Control API → Edge Gateway    Session invalidation, config  │
│  REST HTTP       Provider Node → Control API   Registration, heartbeat       │
│  REST HTTP       Admin CLI → Control API       Admin operations              │
│                                                                              │
│  WebSocket       Frontend → Control API        Explorer real-time updates    │
│  WebSocket       Frontend → Control API        Notifications                 │
│                                                                              │
│  gRPC Stream     Edge Gateway → Blockchain     Usage events, settlement      │
│                                                                              │
│  NATS JetStream  Control API → subscribers     user.registered               │
│                  Control API → subscribers     session.created/closed        │
│                  Control API → subscribers     payment.processed             │
│                  Control API → subscribers     node.online/offline           │
│                  Control API → subscribers     dispute.filed/resolved        │
│                  Control API → subscribers     proposal.created/voted        │
│                                                                              │
│  Redis Pub/Sub   Control API → Edge Gateway    Session cache invalidation    │
│  Redis Cache     Edge Gateway reads            Session data, pricing         │
│  Redis Cache     Control API reads/writes      Rate limits, presence         │
│                                                                              │
│  TCP Yamux       Edge Gateway ← Provider Node  Reverse tunnel (bandwidth)   │
│                                                                              │
│  PostgreSQL      Control API (GORM)            Primary read/write            │
│  PostgreSQL      Control API (read replica)    Analytics queries (optional)  │
│                                                                              │
│  Solana RPC      Control API → Devnet/Mainnet  Balance checks, settlement   │
│  Solana WS       Control API ← Devnet/Mainnet  On-chain event subscriptions │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 2.3 Startup & Dependency Chain

```
Boot Order (Docker Compose)
═══════════════════════════════════════════════════════════
  [1] postgres:5432 ──────── health: pg_isready
  [1] redis:6379 ─────────── health: redis-cli ping
  [1] nats:4222 ──────────── health: wget /varz
        │
        ▼ (all healthy)
  [2] db-migrate (init) ───── runs SQL migrations → exits
        │
        ▼ (completed)
  [3] control-api:8080 ────── health: GET /health
        │
        ▼ (healthy)
  [4] edge-gateway:3128/8090 ─ health: GET /health
  [4] web:3000
  [4] admin:3002
        │
        ▼ (all up)
  [5] prometheus:9091
  [5] grafana:3001
  [5] redis-exporter:9121
```

---

## 3. Subsystems Deep Dive

### 3.1 Control API — Core Orchestrator (Go)

**Location:** `services/control-api/`
**Language:** Go 1.24.0
**Framework:** Gin
**Port:** 8080

The Control API is the central nervous system of ProxyHubb. Every operation — from user registration to blockchain settlements — flows through this service. It owns the database, manages business logic, and coordinates all other services.

#### Internal Package Structure

```
services/control-api/
├── main.go                          Entry point, DI wiring
├── internal/
│   ├── api/                         40+ HTTP handlers
│   │   ├── auth.go                  JWT + OAuth (Google/GitHub)
│   │   ├── wallet.go                SOL wallet CRUD + transfers
│   │   ├── kyc.go                   KYC webhook handler
│   │   ├── orders.go                Marketplace order lifecycle
│   │   ├── sessions.go              Proxy session management
│   │   ├── provider_nodes.go        Node registration + heartbeat
│   │   ├── circles.go               Bandwidth pools
│   │   ├── escrow.go                Escrow transactions
│   │   ├── disputes.go              Dispute filing
│   │   ├── dispute_jury.go          Jury voting
│   │   ├── explorer.go              Node map data
│   │   ├── explorer_ws.go           WebSocket real-time updates
│   │   ├── governance.go            DAO proposals + voting
│   │   ├── analytics.go             Usage + revenue reports
│   │   ├── reviews.go               Rating system
│   │   ├── profile.go               User profiles + follows
│   │   ├── friends.go               Friendship system
│   │   ├── notifications.go         In-app notifications
│   │   ├── agents.go                AI agent registry
│   │   ├── listing_social.go        Listing inquiries
│   │   ├── milestones.go            Escrow milestones
│   │   └── admin.go                 Admin operations
│   ├── models/                      GORM data models (35+ files)
│   ├── db/                          DB connection, GORM setup
│   ├── redis/                       Redis client + cache helpers
│   ├── solana/                      Solana oracle client
│   │   ├── client.go                RPC client, multi-endpoint failover
│   │   ├── settlement.go            Escrow settlement transactions
│   │   ├── multisig_oracle.go       Multi-sig validation
│   │   └── velocity.go              Transfer rate limiting
│   ├── billing/                     Payment processing
│   │   ├── batch_payout.go          Batch SOL payouts
│   │   ├── worker.go                Background payout worker
│   │   ├── channel_service.go       Payment channels
│   │   └── zk_aggregator.go         ZK proof aggregation (WIP)
│   ├── pricing/                     Dynamic price feeds
│   ├── treasury/                    Treasury management
│   ├── worker/                      Background job workers
│   ├── middleware/                  Auth, CORS, rate limiting
│   ├── config/                      Config loading
│   ├── monitoring/                  Prometheus metrics
│   ├── nats/                        NATS event publishing
│   ├── events/                      Redis-based event queue
│   ├── geoip/                       MaxMind GeoIP lookups
│   ├── governance/                  DAO voting logic
│   ├── alerts/                      Slack + email alerting
│   ├── crypto/                      AES-256-GCM encryption
│   ├── health/                      Health check system
│   └── core/services/               Domain service layer
│       └── billing_service.go       Usage verification + aggregation
```

#### Key API Endpoint Groups

| Group | Path Prefix | Key Operations |
|-------|------------|----------------|
| Auth | `/auth` | register, login, OAuth, refresh, logout |
| Profile | `/profile`, `/users` | CRUD, follow, public view |
| Wallet | `/wallet` | balance, deposit, withdraw, transfer, limits |
| Sessions | `/sessions` | create, list, revoke, credentials |
| Orders | `/orders`, `/sales` | create, pay, cancel, escrow initiation |
| Providers | `/providers` | register, nodes, heartbeat, earnings |
| Circles | `/circles` | create, join, lease, SLA, stats |
| Escrow | `/escrow` | create, release, status |
| Disputes | `/disputes` | file, vote, resolve |
| Explorer | `/explorer` | nodes, stats, WS |
| Governance | `/governance` | proposals, vote, leaderboard |
| KYC | `/kyc` | webhook, status |
| Analytics | `/analytics` | usage, revenue, provider, nodes |
| Notifications | `/notifications` | list, read, preferences |
| Social | `/social` | feed, friends, messages |
| Agents | `/agents` | registry, instances, jobs |
| Admin | `/admin` | users, disputes, payouts, analytics |

#### Authentication Model

```
User Registration/Login:
  Email+Password OR OAuth (Google/GitHub) → JWT (signed: JWT_SECRET)

Wallet-Based Login:
  Request challenge → Sign with Solana wallet private key → JWT issued

Admin Access:
  Separate ADMIN_JWT_SECRET + static credentials in env

Provider Node:
  API key → POST /provider/auth → short-lived JWT for node operations

Token Storage:
  - JWT in browser localStorage as "proxyhubb_token"
  - Refresh token families tracked in DB (prevents token reuse)
  - Session credentials encrypted in DB (AES-256-GCM, prefix "ENC:")
```

---

### 3.2 Edge Gateway Engine (Rust)

**Location:** `services/edge-gateway/`
**Language:** Rust (2021 edition)
**Ports:** 3128 (proxy), 8090 (metrics/API/health)

The Edge Gateway is the performance-critical component that sits between consumers and providers. Built in Rust for maximum throughput with minimal latency.

#### Internal Structure

```
services/edge-gateway/src/
├── main.rs              Server bootstrap, TLS setup, listener binding
├── config.rs            Configuration from env vars
├── auth.rs              JWT validation, session lookup
├── tunnel.rs            Core proxy tunneling (SOCKS5 + HTTP CONNECT)
├── proxy/               Proxy protocol implementations
├── routing/             Request routing and load balancing
├── registry/            Provider registry management
├── pool/                Connection pool for provider tunnels
├── billing/             Usage metering, byte counting
├── pricing/             Dynamic price calculation
├── security/            GeoIP country filtering, rate limiting
├── blockchain/          Solana gRPC streaming client
├── multiregion/         Multi-region support
├── policy.rs            Access policy enforcement
├── state.rs             Global shared state (Arc<RwLock>)
├── metrics.rs           Prometheus metrics definitions
├── control_api.rs       REST calls to Control API
├── heartbeat.rs         Keepalive to Control API
├── leader.rs            Leader election (Redis-based)
└── circuitbreaker.rs    Circuit breaker pattern
```

#### Core Proxy Flow

```
Client TCP connection to :3128
         │
         ▼
  Protocol detection (SOCKS5 handshake or HTTP CONNECT)
         │
         ▼
  auth.rs: Validate JWT token
    → Check local LRU cache first (100k entries, 300s TTL)
    → On miss: call Control API /sessions/:id
    → Store in Redis + LRU
         │
         ▼
  policy.rs: Check GeoIP allow/deny lists
         │
         ▼
  routing/: Select best provider node
    → Check provider health (circuit breaker state)
    → Load balance (round-robin / ML ONNX scoring)
         │
         ▼
  pool/: Get or create Yamux stream to provider
         │
         ▼
  tunnel.rs: Bidirectional byte relay
    → Count bytes_up, bytes_down
    → Sign usage: Ed25519(session_id:up:down:nonce)
         │
         ▼
  billing/: Publish usage event via gRPC stream
         │
         ▼
  Provider Node → Target Website
```

#### Key Features

| Feature | Implementation |
|---------|---------------|
| Session Cache | 2-tier: in-process LRU (fast) + Redis (shared) |
| GeoIP Filtering | MaxMind GeoLite2 DB, country-level allow/deny |
| Circuit Breaker | Auto-pause provider on 3+ failures in 60s |
| ML Routing | Optional ONNX model for provider scoring |
| Metrics | Prometheus histogram for latency, counters for bytes |
| Multi-Region | Redis-based leader election, follower forwarding |
| TLS | tokio-rustls for encrypted proxy sessions |

---

### 3.3 Proxy Gateway & Pool Engine

The proxy gateway engine refers to the connection pool and routing layer inside the Edge Gateway, which manages how provider node tunnels are maintained and how incoming consumer connections are dispatched.

#### Provider Pool Management

```
registry/ — Tracks all registered provider nodes
  Fields per node:
    - node_id, provider_id
    - ip_address, country, city
    - connection_type (residential/mobile/datacenter/fiber)
    - active_sessions count
    - bandwidth_gb
    - last_heartbeat timestamp
    - circuit_breaker_state

pool/ — Maintains persistent Yamux-multiplexed streams
  ┌─────────────────────────────────────────────────┐
  │  ConnectionPool<NodeID, Arc<YamuxSession>>      │
  │                                                 │
  │  acquire(node_id) → gets or creates stream      │
  │  release(node_id, stream) → returns to pool     │
  │  evict(node_id) → removes dead connections      │
  └─────────────────────────────────────────────────┘
```

#### Load Balancing Strategies

1. **Round-Robin** (default): Distributes evenly across healthy nodes
2. **Geo-Affinity**: Prefers nodes in the same country as consumer
3. **ML-Based** (optional): ONNX model scoring nodes by historical quality metrics
4. **Circuit-Breaker-Aware**: Skips nodes in `OPEN` circuit state

---

### 3.4 Provider Node Daemon (Rust)

**Location:** `services/provider-node/`
**Language:** Rust
**Metrics Port:** 9090

The provider node daemon is a lightweight process that providers run on their machines to contribute bandwidth to the network.

#### Command Interface

```
provider-node register    Register with Control API (uses API key)
provider-node start       Connect tunnel to Edge Gateway, serve traffic
provider-node metrics     Display real-time stats
provider-node stop        Graceful shutdown
```

#### Operational Flow

```
1. REGISTER
   → Read provider.toml (gateway_addr, api_key)
   → POST /provider/nodes to Control API
   → Receive node_id, JWT token
   → Save to provider.toml

2. START
   → Connect TCP to Edge Gateway :3128
   → Yamux session handshake (reverse tunnel)
   → Gateway can now open streams through this connection
   → Launch HeartbeatManager (30s interval)

3. HEARTBEAT (every 30s)
   → Collect sysinfo (CPU%, RAM%, uptime)
   → Collect local stats (active_connections, bytes_up/down)
   → POST /provider/nodes/:id/heartbeat
   → Update last_heartbeat, node status

4. STREAM HANDLING
   → Gateway opens Yamux sub-stream
   → Daemon reads target address
   → Opens TCP connection to target
   → Bidirectional relay
   → Report bytes to Gateway
```

#### Configuration (`provider.toml`)

```toml
gateway_addr = "localhost:3128"
jwt_token = ""
api_key = ""
node_id = ""
connection_type = "fiber"          # residential|mobile|datacenter|fiber
metrics_enabled = true
metrics_port = 9090
reconnect_interval = "5s"
```

---

### 3.5 Blockchain Engine (Solana + Anchor)

**Smart Contract Location:** `services/solana-programs/proxyhub/`
**Oracle Client Location:** `services/control-api/internal/solana/`
**Network:** Devnet (configurable for mainnet)
**Program ID:** `2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7`

#### Smart Contract Account Types

```rust
// Core Escrow Account (PDA)
Escrow {
    buyer: Pubkey,              // Consumer's wallet
    seller: Pubkey,             // Provider's wallet
    amount: u64,                // Locked lamports
    bandwidth_limit_gb: u64,    // Purchased bandwidth
    bandwidth_used_gb: u64,     // Consumed bandwidth
    status: EscrowStatus,       // Pending|Active|Settled|Refunded|Disputed
    created_at: i64,
    expires_at: i64,
    price_oracle: Pubkey,       // Which oracle validated price
    price_timestamp: i64,
    bump: u8,
}

// Platform State
ProgramState {
    admin: Pubkey,
    paused: bool,               // Emergency kill switch
    min_oracle_signatures: u8,  // Multisig threshold
    price_validity_seconds: i64,
    bump: u8,
}

// Multi-Sig Oracle
MultiSigOracle {
    signers: Vec<Pubkey>,       // Up to 5 oracle signers
    threshold: u8,              // Minimum 3 required
    nonce: u64,                 // Replay protection
    last_update: i64,
    bump: u8,
}
```

#### Key Instructions

| Instruction | Caller | Effect |
|-------------|--------|--------|
| `settle_escrow` | Oracle | Calculates payout = used_gb/total_gb × amount, transfers to seller |
| `emergency_refund` | Oracle/Admin | Returns all locked SOL to buyer |
| `slash_stake` | Admin | Penalizes misbehaving provider |
| `submit_usage_proof` | Oracle | Records usage evidence on-chain |
| `pause_program` | Admin | Emergency platform halt |

#### Oracle Client (Go) — `internal/solana/`

```go
// Multi-endpoint failover
OracleClient {
    rpcClients []*rpc.Client       // Multiple RPC endpoints
    currentIdx int                  // Round-robin index
    programID  sol.PublicKey
    oracleKey  sol.PrivateKey
    velocity   *VelocityGuard
}

// Velocity Guards (security caps)
VelocityGuard {
    MaxSingleTransferSOL:  50 SOL
    MaxHourlyOutflowSOL:   500 SOL
    EmergencyFreeze:       bool   // ENV: ORACLE_TRANSFER_FREEZE
}
```

#### gRPC Streaming Protocol

The Edge Gateway streams usage events to the settlement layer via gRPC:

```protobuf
service UsageStream {
    rpc StreamUsage(stream UsageEvent) returns (stream StreamStatus);
    rpc SettleProvider(stream SettlementRequest) returns (stream SettlementResponse);
    rpc GetCurrentPricing(PricingRequest) returns (PricingResponse);
}

message UsageEvent {
    string session_id;
    string user_id;
    string provider_id;
    string node_id;
    uint64 bytes_up;
    uint64 bytes_down;
    uint64 timestamp_ms;
    uint64 duration_seconds;
    bytes  signature;          // Ed25519(session_id:up:down:timestamp:nonce)
    uint64 nonce;              // Replay protection
    string country_code;
    uint32 latency_ms;
    uint32 packet_loss_percent;
}
```

#### Price Feed System (Multi-Source Failover)

```
Priority 1: CoinGecko API (COINGECKO_API_KEY)
Priority 2: Binance Public API
Priority 3: CoinMarketCap (COINMARKETCAP_API_KEY)
Priority 4: Hardcoded fallback (EMERGENCY_SOL_PRICE_USD = 200 USD/SOL)
```

---

### 3.6 Financial Engine

#### Wallet System

**Model:** `internal/models/wallet.go`

```
Wallet
  └── id (UUID)
  └── user_id (UUID, unique — one wallet per user)
  └── balance_sol (float64)
  └── limits_enabled (bool)
  └── daily_limit / weekly_limit / monthly_limit (float64, SOL)
  └── limit_window_start (time.Time)

WalletLedgerEntry
  └── wallet_id
  └── amount (positive=credit, negative=debit)
  └── balance_after
  └── type: topup | usage | payout | refund | earning | swap
  └── reference_id (Solana tx signature, 88 chars)
  └── description
```

**Trust-Tier Spending Limits:**

| Tier | Daily | Weekly | Monthly |
|------|-------|--------|---------|
| New | 1 SOL | 5 SOL | 20 SOL |
| Verified | 10 SOL | 50 SOL | 200 SOL |
| Premium | 100 SOL | 500 SOL | Unlimited |

#### Batch Payout Engine

**File:** `internal/billing/batch_payout.go`

```
BatchConfig (defaults):
  ImmediateThresholdSOL:     10 SOL     → skip queue if >= 10 SOL
  MaxBatchSize:              20         → payouts per batch
  MinBatchSize:              5          → wait for more if below
  MaxWaitTime:               30 min     → force flush after 30 min
  ProcessInterval:           15 min     → worker tick rate

Batch Payout Lifecycle:
  1. ProviderEarning created (status=pending)
  2. Aggregated into PendingPayout queue
  3. Worker runs every 15 min
  4. Groups into BatchPayout (max 20)
  5. Oracle signs + submits Solana transaction
  6. DB updated: BatchPayout status=completed, PendingPayout cleared
  7. WalletLedgerEntry created for provider
```

**Idempotency:** SHA256 of sorted session IDs prevents double-payouts on retry.

**Circuit Breaker:** 3 consecutive failures → 5-minute pause.

#### KYC & Trust Tier Flow

```
User signs up (TrustTier=New)
       │
       ▼
User links Solana wallet
       │
       ▼
External KYC provider sends webhook → POST /kyc/webhook
       │
       ▼
Check: is wallet address set?
  No  → status = pending
  Yes → Query Solana for on-chain balance
         Balance < 0.05 SOL → KYCStatusInsufficientFunds
         Balance >= 0.05 SOL → KYCStatusApproved, TrustTier=Verified
```

---

### 3.7 Social Services

#### Follows System

```
Table: follows
  follower_id → following_id (composite PK)
  created_at

Rules:
  - No self-following (BeforeCreate hook)
  - Bidirectional counted: followers_count, following_count (on profiles)

Endpoints:
  POST   /users/:id/follow
  DELETE /users/:id/follow
  GET    /users/:id/followers
  GET    /users/:id/following
```

#### Reviews & Rating System

```
Table: reviews
  reviewer_id, reviewed_user_id, order_id
  rating (1-5 overall)
  speed_rating, reliability_rating, support_rating, value_rating
  title, body
  verified_purchase (bool)

Rules:
  - Must have completed/active order with the reviewed user
  - One review per order
  - Seller's avg_rating and reviews_count auto-updated

Phase 21 Feature: Reviews cryptographically hashed and anchored to Solana oracle
```

#### Friendship System

```
Tables: friend_requests, friendships

Flow:
  POST /friends/request/:id   → FriendRequest (status=pending)
  POST /friends/accept/:id    → Creates bidirectional Friendship records
                                 (transactional — both rows or neither)
  POST /friends/reject/:id    → FriendRequest status=rejected
  DELETE /friends/:id         → Removes both friendship rows

Rules:
  - Prevents duplicate requests
  - Prevents reverse-request if one already exists
  - Used for: session sharing permissions, circle invites
```

#### Feed & Notifications

```
Table: feed_events
  actor_id, target_id, event_type, metadata (JSONB)
  created_at

Event Types triggered:
  - new_review       (on review creation)
  - new_follow       (on follow)
  - order_placed     (on order creation)
  - dispute_filed    (on dispute)
  - proposal_created (on governance proposal)

Table: notifications
  user_id, type, title, body, action_url
  actor_id (who triggered it)
  read_at (null = unread)
  channels_sent: in_app | email | push

Notification Types:
  Social:   new_follower, friend_request, friend_accepted, message, mention
  Business: new_order, order_complete, payment_received, listing_sold
  Community: reply, upvote, badge_earned, thread_featured
  System:   security_alert, maintenance, verification, trust_tier_change
```

#### Messaging System

```
Tables: conversations, messages

Conversations: buyer-seller or any user pairs
Messages: content, sender_id, conversation_id, created_at

API:
  GET  /conversations         → List user's conversations
  POST /conversations         → Start new conversation
  GET  /conversations/:id/messages
  POST /conversations/:id/messages
```

---

### 3.8 Proxy Explorer

The Proxy Explorer provides a real-time visualization of all provider nodes in the network.

#### Node Map (3D Globe)

**Frontend:** `apps/web/src/app/explorer/map/page.tsx`

```
Technology: Three.js + WebGL (SSR disabled, client-only)
Data Source: WebSocket /v1/explorer/ws → real-time node events
Fallback: Country centroid coordinates if GeoIP resolution fails

Map Layers:
  - 3D rotating globe (Earth texture)
  - Node pins (color-coded: green=online, orange=degraded, red=offline)
  - Heatmap overlay (session density)

Map Styles: Globe | Satellite | Terrain | Classic 2D
```

#### Real-Time WebSocket Updates

**Backend:** `internal/api/explorer_ws.go`

```
Connection: ws://host:8080/v1/explorer/ws
Auth: JWT token in query param or header

Event Types pushed to clients:
  node.online          → New node appeared
  node.offline         → Node went offline (no heartbeat > 30 min)
  node.updated         → Metrics changed (sessions, bandwidth)
  network.stats        → Aggregate stats (total nodes, total bandwidth)

Distribution: NATS-based broadcast hub (multi-instance safe)
```

#### Node Listing & Filtering

**Frontend:** `apps/web/src/app/explorer/nodes/page.tsx`

```
Sort Columns: uptime_percent, bandwidth_gb, active_sessions, last_heartbeat
Filter: type (all/validator/proxy), active-only toggle
View: Compare mode (max 3 nodes side-by-side)
Pagination: 20 per page
Refresh: Auto-refresh every 30s (react-query)

Data shown per node:
  - Name, Country flag + city
  - Connection type (residential/mobile/datacenter/fiber)
  - Uptime percentage
  - Bandwidth served (GB)
  - Active sessions count
  - Last heartbeat timestamp
  - Performance badges
```

#### Node Data Flow (Heartbeat → Explorer)

```
Provider Node
  └── POST /provider/nodes/:id/heartbeat (every 30s)
        └── Control API updates: last_heartbeat, status, bandwidth, sessions
              └── NATS publishes: node.updated
                    └── Explorer WebSocket handler broadcasts to connected browsers
                          └── Globe re-renders node pin with new data
```

#### NodeSync (IP → Explorer Map)

When a node registers, the Control API runs a `NodeSync` process:
1. Looks up IP with MaxMind GeoIP
2. Sets country, city, latitude, longitude
3. Publishes to marketplace listing simultaneously

---

### 3.9 Database System

#### PostgreSQL Schema (50+ Tables)

```
CORE USER TABLES
  profiles                 User accounts (username, email, role, kyc_status, trust_tier)
  api_keys                 API key management
  refresh_token_families   JWT refresh token tracking
  totp_backup_codes        2FA backup codes
  kyc_verifications        KYC submission records

WALLET & FINANCIAL
  wallets                  SOL balance + spending limits
  wallet_ledger_entries    Full transaction history (append-only)
  linked_wallets           Multi-chain (Solana/Ethereum) wallet associations
  pending_payouts          Payout queue
  batch_payouts            Batch settlement records
  batch_payout_items       Individual payout items in a batch

MARKETPLACE
  proxy_listings           Provider offerings (price, bandwidth, connection type)
  orders                   Purchase orders (buyer→seller)
  saved_listings           User bookmarks

ESCROW & DISPUTES
  escrow_transactions      In-progress escrow records
  disputes                 Dispute filings
  dispute_jury             Jury member voting records

SESSIONS & USAGE
  sessions                 Active proxy sessions (encrypted credentials)
  encrypted_credentials    AES-256-GCM credential storage
  usage_records            Per-session bandwidth usage
  proof_of_service         Usage proof records
  provider_earnings        Per-session provider income records

SOCIAL FEATURES
  follows                  Follow graph (follower_id → following_id)
  friendships              Bidirectional friendship records
  friend_requests          Pending friend requests
  reviews                  User reviews with ratings
  conversations            DM threads
  messages                 Message content
  feed_events              Activity feed events
  notifications            In-app notifications
  notification_preferences Per-user notification settings
  badges                   Achievement badge definitions
  user_badges              User badge ownership

CIRCLES (Bandwidth Pools)
  circles                  Pool definitions
  circle_members           Pool membership
  circle_invites           Pending invitations
  circle_leases            Bandwidth leases within pools
  circle_posts             Social posts in circles
  circle_slas              Service level agreements
  circle_stats             Pool aggregate statistics

GOVERNANCE
  proposals                DAO proposals
  governance_votes         Vote records
  miner_weights            Provider reputation scores

FORUM
  forum_categories         Discussion categories
  forum_threads            Thread records
  forum_posts              Post content
  forum_votes              Upvote/downvote records

AGENTS
  agents                   Agent definitions
  agent_instances          Running agent instances
  agent_jobs               Job execution records
  agent_outputs            Job results
  market_agents            Marketplace agents

NODES & PROVIDERS
  nodes                    Provider node registry
  provider_nodes           Node metadata + heartbeat state
  provider_applications    Provider signup applications

BLOCKCHAIN
  blockchain_state_cache   On-chain account snapshots
  pending_transactions     Pending Solana tx queue

ANALYTICS & AUDIT
  audit_logs               All API events (structured, filterable)
  subscription_plans       Tier definitions
  user_subscriptions       User tier assignments
  use_cases                Platform use case tags
  user_preferences         User settings/preferences
```

#### Row-Level Security (RLS)

All tables have RLS enabled via a migration that applies policies:
- `USING (user_id = auth.uid())` — users see only their own rows
- Public tables (proposals, reviews) readable by all authenticated users
- Admin role bypasses all RLS policies

#### Redis Cache Layout

```
Key Patterns:
  session:{session_id}           → Session data (TTL: 300s)
  rate:{user_id}:{endpoint}      → Rate limit counter (TTL: window)
  presence:{user_id}             → Online presence (TTL: 5 min)
  price:sol_usd                  → SOL price (TTL: 60s)
  node:{node_id}:health          → Node health state
  circuit:{node_id}              → Circuit breaker state

Configuration:
  Max memory: 512MB
  Eviction: allkeys-lru
  Persistence: AOF (appendonly yes)
  Auth: REDIS_PASSWORD required
```

#### NATS JetStream Subjects

```
Subjects:
  user.registered          → New user signup event
  user.kyc.updated         → KYC status change
  session.created          → New proxy session
  session.closed           → Session ended
  session.usage            → Usage update (bytes)
  payment.processed        → Successful payment
  payment.failed           → Payment failure
  node.online              → Provider node came online
  node.offline             → Provider node went offline
  node.heartbeat           → Regular heartbeat update
  dispute.filed            → New dispute
  dispute.resolved         → Dispute outcome
  governance.proposal      → New DAO proposal
  governance.voted         → Vote cast

JetStream Storage: File-based (survives restart)
```

---

### 3.10 Admin CLI & Admin Panel

#### Admin CLI (Rust)

**Location:** `services/admin-cli/src/main.rs`

```
Commands:
  admin-cli ping          → Health check Control API
  admin-cli seed          → Seed treasury wallet address into DB
  admin-cli cleanup-db    → Drop problematic tables for FK migration fixes
  admin-cli verify-flow   → E2E governance test (create proposal → vote → verify)
```

#### Admin Web Panel (Next.js)

**Location:** `apps/admin/` (Port 3002)

```
Dashboard Sections:
  /admin/users              → User list, search, KYC status, trust tier
  /admin/users/:id          → User detail, session history, wallet
  /admin/users/:id/ban      → Ban/suspend user
  /admin/disputes           → Dispute queue, voting records
  /admin/disputes/:id       → Dispute detail + resolution tools
  /admin/payouts            → Pending payouts, trigger batch, history
  /admin/nodes              → All provider nodes, health
  /admin/analytics          → Platform-wide stats (users, sessions, revenue)
  /admin/audit              → Audit log viewer (filterable by event type)
  /admin/applications       → Provider application review queue
  /admin/kyc-queue          → KYC verification review
```

---

### 3.11 Web Frontend (Next.js)

**Location:** `apps/web/` (Port 3000)
**Framework:** Next.js 15.3.3 with App Router
**Language:** TypeScript

#### Key Pages

```
/ (home)                     Landing page
/marketplace                 Browse proxy listings
/marketplace/:id             Listing detail + purchase
/explorer                    Network overview
/explorer/map                3D globe visualization
/explorer/nodes              Tabular node listing + compare
/dashboard                   User home
/dashboard/profile           Edit profile
/dashboard/wallet            Balance, transactions, limits
/dashboard/sessions          Active proxy sessions
/dashboard/orders            Purchase history
/dashboard/provider/         Provider-only area
  /register                  Join as provider
  /nodes                     Node management
  /earnings                  Revenue dashboard
  /analytics                 Performance metrics
  /health                    Node health monitoring
/governance                  DAO proposals
/governance/:id              Proposal detail + voting
/circles                     Bandwidth pools
/circles/:id                 Pool detail + membership
/social/feed                 Activity feed
/social/friends              Friends list + requests
/messages                    Conversations
/messages/:id                Chat view
/notifications               Notification center
/settings                    Account settings
/admin/                      Admin panel (role-gated)
```

#### Auth Flow (Wallet-Based)

```
1. User clicks "Connect Wallet"
2. Solana wallet browser extension (Phantom/Backpack) connects
3. Frontend: GET /v1/auth/wallet/challenge?address={pubkey}
4. Backend returns: { message: "Sign this message: {nonce}" }
5. User signs message with wallet private key
6. Frontend: POST /v1/auth/wallet/login { address, signature, message }
7. Backend verifies Ed25519 signature
8. Backend returns: { token: "JWT...", user: {...} }
9. Token stored: localStorage["proxyhubb_token"]
10. All subsequent requests: Authorization: Bearer {token}
```

#### Service Layer

```
apps/web/src/lib/api/          Raw API call functions
apps/web/src/lib/services/     Business logic wrappers
  profile.ts                   Identity management
  social.ts                    Messaging, friends, feed
  explorer.ts                  Node/blockchain data
  marketplace.ts               Listing search, orders
  analytics.ts                 Usage metrics
  governance.ts                DAO voting
  notifications-api.ts         Notification CRUD
  relationships.ts             Provider-buyer connections
```

---

### 3.12 Relayer Service (Go)

**Location:** `services/relayer/`
**Language:** Go 1.22+

The Relayer handles Ethereum-side payout processing (the Ethereum path of the dual-chain design).

```
Purpose: Process batch payout transactions on Ethereum
Config:
  ETH_RPC_URL                  Ethereum node endpoint
  RELAYER_PRIVATE_KEY           Signing key for transactions
  MARKETPLACE_CONTRACT_ADDRESS  Smart contract address

Operations:
  - Poll DB for pending_payouts (status=pending)
  - Group into batches
  - Sign and submit to Ethereum smart contract
  - Update DB on success/failure
  - Retry logic with exponential backoff

Schedule: Runs hourly batch job
```

---

## 4. Data Flow Diagrams

### 4.1 Consumer Proxy Usage Flow

```
CONSUMER PROXY USAGE FLOW
════════════════════════════════════════════════════════════════════

  CONSUMER                 EDGE GATEWAY           CONTROL API
  ─────────                ────────────           ───────────
      │                         │                      │
      │  Configure SOCKS5       │                      │
      │  proxy: host:3128       │                      │
      │                         │                      │
      │──TCP Connect ──────────►│                      │
      │                         │                      │
      │  SOCKS5 handshake       │                      │
      │◄─────────────────────────│                      │
      │                         │                      │
      │  Auth: session_id/pass  │                      │
      │────────────────────────►│                      │
      │                         │  GET /sessions/:id   │
      │                         │─────────────────────►│
      │                         │  ← session data      │
      │                         │     (cached: Redis)  │
      │                         │                      │
      │                         │  GeoIP check         │
      │                         │  (MaxMind lookup)    │
      │                         │                      │
      │                         │  Select provider node│
      │                         │  (load balance)      │
      │                         │                      │
      │                   ──────▼──────          PROVIDER NODE
      │                  |  Yamux Mux  |         ─────────────
      │                   ─────────────                │
      │                         │  Open Yamux stream  │
      │                         │────────────────────►│
      │                         │                      │
      │  Target: example.com:80 │                      │
      │────────────────────────►│                      │
      │                         │  Connect to target  │
      │                         │────────────────────►│──► example.com
      │                         │                      │
      │◄═══════════════════════════════════════════════│◄══ response
      │    Bidirectional relay  │                      │
      │                         │                      │
      │  [bytes counted]        │  billing/: sign usage│
      │                         │  Ed25519(sess:up:down│
      │                         │  :nonce)             │
      │                         │                      │
      │                         │  gRPC UsageEvent ───►│  Blockchain layer
      │                         │                      │  (settlement queue)
      │                         │                      │

════════════════════════════════════════════════════════════════════
```

### 4.2 Provider Earnings Flow

```
PROVIDER EARNINGS FLOW
════════════════════════════════════════════════════════════════════

  EDGE GATEWAY            CONTROL API               SOLANA
  ────────────            ───────────               ──────
      │                       │                        │
      │  gRPC: UsageEvent     │                        │
      │──────────────────────►│                        │
      │   (session_id,        │                        │
      │    bytes_up/down,     │                        │
      │    Ed25519 signature, │                        │
      │    nonce)             │                        │
      │                       │  Verify Ed25519 sig    │
      │                       │  Check nonce (replay)  │
      │                       │  Aggregate bandwidth   │
      │                       │                        │
      │                       │  Create ProviderEarning│
      │                       │  (status=pending)      │
      │                       │                        │
      │                       │  ◄── Worker tick (15m)─┤
      │                       │  Group into batch      │
      │                       │  (max 20 payouts)      │
      │                       │                        │
      │                       │  Idempotency check     │
      │                       │  SHA256(session_ids)   │
      │                       │                        │
      │                       │  VelocityGuard check   │
      │                       │  (max 50 SOL/tx)       │
      │                       │  (max 500 SOL/hour)    │
      │                       │                        │
      │                       │  Oracle signs tx ─────►│
      │                       │                        │  settle_escrow()
      │                       │                        │  → calc payout
      │                       │                        │  → transfer SOL
      │                       │                        │  → provider wallet
      │                       │◄── txHash ─────────────│
      │                       │                        │
      │                       │  BatchPayout=completed │
      │                       │  WalletLedger+=earning │
      │                       │  ProviderEarning=paid  │

════════════════════════════════════════════════════════════════════
```

### 4.3 Escrow Payment Lifecycle

```
ESCROW PAYMENT LIFECYCLE
════════════════════════════════════════════════════════════════════

  CONSUMER                CONTROL API             SOLANA ESCROW
  ────────                ───────────             ─────────────
      │                       │                         │
      │  Browse marketplace   │                         │
      │  Select listing       │                         │
      │                       │                         │
      │  POST /orders         │                         │
      │─────────────────────► │                         │
      │                       │  Check buyer balance    │
      │                       │  Fetch SOL price        │
      │                       │  Calculate: USD → SOL   │
      │                       │                         │
      │                       │  Derive Escrow PDA      │
      │                       │  (buyer+seller pubkeys) │
      │                       │                         │
      │◄── { escrow_pda,     │                         │
      │      amount_sol,      │                         │
      │      instructions }───│                         │
      │                       │                         │
      │  Sign + submit tx     │                         │
      │─────────────────────────────────────────────── ►│
      │                       │                         │  Lock SOL in PDA
      │                       │                         │  status=Active
      │◄── txSignature ───────────────────────────────  │
      │                       │                         │
      │  POST /orders/:id/pay │                         │
      │  { txSignature }      │                         │
      │─────────────────────►│                         │
      │                       │  Verify tx on-chain     │
      │                       │  Create session         │
      │                       │  (status=active)        │
      │                       │                         │
      │  ═══ Service Active ═══════════════════════════ │
      │  Proxy usage flows    │  Metering accumulates   │
      │                       │                         │
      │  [bandwidth consumed] │  Oracle validates usage │
      │                       │─────────────────────── ►│
      │                       │                         │  settle_escrow()
      │                       │                         │  payout = used/total × amount
      │                       │                         │  → transfer to seller
      │                       │                         │  → refund remainder to buyer
      │                       │                         │  status=Settled
      │                       │                         │
      │                       │  ProviderEarning created│
      │                       │  Session closed         │

DISPUTE PATH:
  Consumer disputes → POST /disputes
  Jury votes (community members with stake)
  Admin resolves: refund to buyer OR release to seller
  On-chain: emergency_refund() OR settle_escrow()

════════════════════════════════════════════════════════════════════
```

### 4.4 Database Entity Relationship Overview

```
DATABASE ENTITY RELATIONSHIP OVERVIEW
════════════════════════════════════════════════════════════════════

  [profiles] ──────────────── has one ──────── [wallets]
      │                                             │
      │ has many                                    │ has many
      │                                             │
  [sessions]                              [wallet_ledger_entries]
      │
      │ belongs to
      │
  [orders] ───── belongs to ──── [proxy_listings] ──── belongs to ── [profiles]
      │               │
      │               │ has one
      │               │
      │           [escrow_transactions]
      │
      │ has one
      │
  [disputes] ── has many ── [dispute_jury]
      │
      │ has many
      │
  [reviews]

  [profiles] ── has many ── [provider_nodes]
                                │
                                │ belongs to
                                │
                            [proxy_listings]

  [profiles] ──── many-to-many (via follows) ──── [profiles]
  [profiles] ──── many-to-many (via friendships) ── [profiles]
  [profiles] ──── many-to-many (via conversations) ─ [profiles]

  [circles] ── has many ── [circle_members] ── belongs to ── [profiles]
  [circles] ── has many ── [circle_leases]
  [circles] ── has many ── [circle_slas]

  [proposals] ── has many ── [governance_votes] ── belongs to ── [profiles]

  [agents] ── has many ── [agent_instances] ── has many ── [agent_jobs]

════════════════════════════════════════════════════════════════════
```

---

## 5. Strengths & Pros

### 1. **Polyglot Architecture with the Right Tools Per Job**
Go's concurrency model handles the API layer efficiently; Rust's zero-cost abstractions deliver the performance needed for the proxy tunnel; TypeScript + Next.js provides a modern, SSR-capable frontend. Each language is chosen for its strengths.

### 2. **True Decentralized Payments via Solana Escrow**
The escrow-based payment model is non-custodial — the platform never holds user funds. Consumers lock SOL in a smart contract PDA; providers receive it only after verifiable service delivery. This is a strong trust model.

### 3. **Multi-Signature Oracle (3-of-5 Threshold)**
The oracle that authorizes fund releases requires 3 of 5 valid signatures, eliminating any single point of compromise for fund disbursement. This is a production-grade security design.

### 4. **Velocity Guards on Fund Outflow**
Hard caps on single transfers (50 SOL) and hourly outflow (500 SOL), plus an emergency freeze switch, limit the blast radius of oracle key compromise or bugs.

### 5. **Multi-Source Price Feed with Fallback**
CoinGecko → Binance → CoinMarketCap → hardcoded fallback ensures the system never completely fails due to a single price API being down.

### 6. **Two-Tier Session Cache (LRU + Redis)**
The Edge Gateway uses an in-process LRU cache (100k entries) backed by Redis, dramatically reducing Control API calls for active sessions. This is a textbook optimization for high-throughput proxy systems.

### 7. **Ed25519 Signed Usage Events with Nonce**
Usage events include an Ed25519 signature from the provider node and a monotonic nonce, making it cryptographically impossible to forge or replay usage reports.

### 8. **Row-Level Security on All Database Tables**
Every table enforces RLS via PostgreSQL policies. Users physically cannot query other users' data, even with direct database access.

### 9. **Circuit Breaker on Provider Nodes**
Automatic circuit breaking (3 failures in 60s → open) prevents cascade failures when a provider node becomes unhealthy, protecting consumer sessions.

### 10. **Rich Social Layer (Unusual for Proxy Platforms)**
Reviews with dimensional ratings (speed, reliability, support, value), a social graph, friendships, circles, and a forum create network effects and reputation systems that increase platform stickiness and trust.

### 11. **Comprehensive Observability Stack**
Prometheus scraping, Grafana dashboards, OpenTelemetry distributed tracing, structured zerolog logging, and health check endpoints on every service make the system highly operable.

### 12. **NATS JetStream for Durable Event Processing**
File-backed JetStream means events are not lost on broker restart, enabling reliable async processing of critical events like payment confirmations and node status changes.

### 13. **Idempotent Batch Payouts**
SHA256 of sorted session IDs as idempotency key ensures that a payout batch can be safely retried without double-paying providers.

### 14. **Governance & DAO Voting**
On-chain governance proposals with jury-based dispute resolution gives the platform a credible path to decentralization and community ownership.

### 15. **Bandwidth Circle Pools**
The "Circles" system for pooling bandwidth across providers is a differentiating feature for enterprise buyers who need SLA guarantees and multi-node redundancy.

### 16. **ZK Proof Aggregation (Work in Progress)**
The presence of `zk_aggregator.go` and a gRPC SettlementRequest with `event_hashes` shows forward-thinking architecture toward zero-knowledge proof of service — a significant privacy/scalability improvement.

---

## 6. Issues & Cons Found

### 6.1 Critical Issues

#### C-01: Circle Pool Payment Execution is Incomplete (TODO)
**File:** `services/control-api/internal/api/circle_pool.go`
**Severity:** Critical — Feature is non-functional
**Description:** The circle pool lease payment handler has an explicit `TODO: Transfer funds to provider's wallet`. When a circle lease completes, the SOL transfer to the provider is never executed. Providers participating in circles are not paid.
**Impact:** Provider funds not transferred; financial loss and provider churn.

---

#### C-02: Dispute Blockchain Settlement is Incomplete (TODO)
**File:** `services/control-api/internal/api/dispute_jury.go`
**Severity:** Critical — Security gap
**Description:** After jury voting concludes, there is a `TODO: Submit to blockchain for on-chain settlement`. The dispute outcome is recorded in the database but the smart contract (`emergency_refund()` or `settle_escrow()`) is never called. Funds remain locked in the escrow PDA indefinitely.
**Impact:** Disputed funds are permanently locked; both buyer and seller lose their money.

---

#### C-03: Milestone Wallet Credit is Incomplete (TODO)
**File:** `services/control-api/internal/api/milestones.go`
**Severity:** Critical — Feature is non-functional
**Description:** When an escrow milestone is marked complete, there is a `TODO: Add credit to user's wallet`. The milestone completion is tracked but the actual SOL credit to the user's wallet balance is never executed.
**Impact:** Users completing service milestones do not receive payment.

---

#### C-04: ZK Settlement Not Connected to Blockchain (TODO)
**File:** `services/control-api/internal/billing/zk_aggregator.go`
**Severity:** Critical — Feature is non-functional
**Description:** The ZK aggregator generates proofs and has a `TODO: call the on-chain ZK settlement instruction once SubmitZKSettlement is implemented`. The ZK pathway is built but not wired to the Solana program instruction.
**Impact:** ZK proof-based settlements (privacy-preserving mode) are silently skipped.

---

#### C-05: SOL Price Division-by-Zero Risk
**File:** `services/control-api/internal/api/orders.go:118-127`
**Severity:** Critical — Potential panic / financial error
**Description:** The price conversion `amountSOL := order.TotalPrice / solPrice` has no guard against `solPrice == 0`. If all price feed sources fail simultaneously (CoinGecko down, Binance down, CoinMarketCap down) and `EMERGENCY_SOL_PRICE_USD` is not set, the denominator becomes zero.
**Impact:** Server panic (division by zero in Go causes panic), order creation crashes, potential for incorrect escrow amounts.

---

### 6.2 High Severity Issues

#### H-01: Multisig Oracle Threshold Not Enforced in Billing Service
**File:** `services/control-api/internal/core/services/billing_service.go:35-44`
**Severity:** High — Security bypass
**Description:** The billing service calls `verifySignature()` with a single public key. The smart contract requires 3-of-5 multisig threshold, but the off-chain billing layer accepts a single signature. The oracle's multisig requirement is a smart contract-level control, but any compromise of the off-chain billing that bypasses signature verification could credit fraudulent bandwidth.
**Impact:** Sophisticated attack could manipulate off-chain earnings records without matching on-chain validation.

---

#### H-02: Escrow PDA Not Verified Against On-Chain Account
**File:** `services/control-api/internal/api/orders.go:109-113`
**Severity:** High — Financial integrity
**Description:** The `oracle.GetEscrowPDA(buyerPubKey, sellerPubKey)` derives a PDA address but the derived address is stored in the database without verification that the on-chain account at that PDA actually contains the expected escrow data. If the PDA derivation logic has a bug or is compromised, payments could be directed to wrong accounts.
**Impact:** Funds locked in wrong PDAs; uncollectable by intended recipient.

---

#### H-03: Settlement Transaction Finality Not Confirmed
**File:** `services/control-api/internal/solana/settlement.go:56-104`
**Severity:** High — Data integrity
**Description:** The settlement function submits a transaction and returns the `txHash` immediately without waiting for Solana finalization (which typically requires ~32 block confirmations). The batch is marked `completed` in the database before the transaction is confirmed.
**Impact:** On Solana network congestion or forks, a transaction may be dropped. The database shows payment as complete but provider never received SOL.

---

#### H-04: Batch Payout Idempotency Missing Wallet Address
**File:** `services/control-api/internal/billing/batch_payout.go:90-97`
**Severity:** High — Double-payment risk
**Description:** The idempotency key is derived as `SHA256(sorted session_ids)`. If a provider changes their linked wallet address between payout attempts, the same idempotency key would exist for a different destination, potentially skipping the payout to the new address.
**Impact:** Providers who change wallet addresses may miss payouts or receive them to the old address.

---

#### H-05: Spending Limits Security Semantics (`LimitsEnabled=false`)
**File:** `services/control-api/internal/models/wallet.go:30-37`
**Severity:** High — Security gap
**Description:** The `LimitsEnabled` boolean gates ALL spending limit enforcement. When `LimitsEnabled=false` (which is the default for new users), there are NO limits regardless of the limit values set. This means new users before KYC can make unlimited transfers.
**Impact:** New/unverified users can potentially drain wallets or make large unauthorized transfers before KYC approval.

---

### 6.3 Medium Severity Issues

#### M-01: KYC — Nullable Wallet Address Edge Case
**File:** `services/control-api/internal/api/kyc.go:57-97`
**Severity:** Medium — Trust tier inflation
**Description:** When a KYC webhook arrives for a user without a linked wallet, the code falls back to setting `status = pending`. However, if the wallet is subsequently linked and the webhook does not re-fire, the user may stay in `pending` indefinitely and never get promoted to `Verified` tier despite completing external KYC.
**Impact:** Legitimate KYC-approved users stuck at `TrustTierNew` with restricted spending limits.

---

#### M-02: Wallet Creation Race Condition
**File:** `services/control-api/internal/api/wallet.go:156-181`
**Severity:** Medium — Data consistency
**Description:** Concurrent wallet creation requests (e.g., double-click or multiple simultaneous API calls) use `OnConflict{DoNothing: true}` but the subsequent "read after insert" may return the wrong wallet. The retry logic attempts to fetch the existing wallet but the code path is not fully transactional.
**Impact:** Users may get inconsistent balance displays; duplicate wallet creation attempts may partially fail.

---

#### M-03: Payment-Session Status Mismatch
**File:** `services/control-api/internal/api/orders.go:66-74`
**Severity:** Medium — UX + state confusion
**Description:** Orders transition from `pending` directly to `active`, conflating two different states: "payment initiated but not confirmed" vs "service is actively running". There is no `pending_payment` intermediate status.
**Impact:** If a payment transaction fails after order creation, the order appears `active` but no session is actually provisioned.

---

#### M-04: Response Time Estimation is Hardcoded
**File:** `services/control-api/internal/api/listing_social.go:136`
**Severity:** Medium — Data quality
**Description:** A TODO notes: `TODO: Calculate from actual message response times`. The listing social endpoint returns a hardcoded response time estimate for providers rather than calculating it from actual conversation response data.
**Impact:** Consumers see inaccurate provider responsiveness metrics, reducing marketplace trust.

---

#### M-05: Inquiry Tracking Not Implemented
**File:** `services/control-api/internal/api/listing_social.go`
**Severity:** Medium — Analytics gap
**Description:** `TODO: Implement inquiry tracking for analytics`. When consumers send inquiries to providers, the inquiry events are not logged for analytics purposes.
**Impact:** Provider conversion metrics (inquiries → orders) cannot be measured, limiting marketplace optimization.

---

#### M-06: Redis Queue Not Using Consumer Groups
**File:** `services/control-api/internal/events/redis_queue.go`
**Severity:** Medium — Reliability
**Description:** `TODO: Upgrade to Consumer Groups for persistent background workers`. The event queue uses basic Redis lists instead of Streams with Consumer Groups, which means events can be lost if the consumer crashes between dequeuing and processing.
**Impact:** Missed events (payment confirmations, node status changes) under crash/restart scenarios.

---

#### M-07: System Health Alerts Incomplete
**File:** `services/control-api/internal/health/system.go`
**Severity:** Medium — Operational risk
**Description:** `TODO: Send email/pagerduty alert here`. When a health check detects a critical system degradation, the alert delivery (email/PagerDuty) is stubbed out. Only Slack webhook alerts are active.
**Impact:** On-call engineers may not receive critical system alerts via their pager if Slack is down or not monitored.

---

#### M-08: Channel Deposit Verification Incomplete
**File:** `services/control-api/internal/billing/channel_service.go`
**Severity:** Medium — Financial integrity
**Description:** `TODO: Verify initial deposit on-chain or check balance`. Payment channel creation does not verify that the buyer's on-chain deposit has actually landed before activating the channel.
**Impact:** Service could be provisioned without confirmed payment.

---

### 6.4 Low Severity Issues

#### L-01: Circuit Breaker Pause State Not Persisted
**File:** `services/control-api/internal/billing/worker.go:24-76`
**Severity:** Low — Operational gap
**Description:** When the payout circuit breaker trips (3 failures → 5-minute pause), this state is in memory only. A service restart resets the circuit breaker, potentially immediately retrying the failing operation.
**Impact:** On rapid restarts during a payment system outage, retry storms could amplify the underlying failure.

---

#### L-02: Orphaned Social Records on User Deletion
**File:** Multiple social models
**Severity:** Low — Data hygiene
**Description:** There are no cascade delete rules for `friendships`, `follows`, `feed_events`, and `notifications` when a user is deleted. Soft deletes (`deleted_at`) on profiles may leave stale records in social tables.
**Impact:** Database bloat; potential for ghost friendship/follow records that surface in counts.

---

#### L-03: Explorer Node Stale Cleanup Not Automated
**File:** `services/control-api/internal/api/explorer.go`
**Severity:** Low — UX
**Description:** Nodes are marked "stale" if no heartbeat for 30 minutes, but there is no automated cleanup job to remove permanently offline nodes from the explorer listing.
**Impact:** Explorer accumulates stale/dead nodes over time, polluting the map and node count statistics.

---

#### L-04: Earnings Export Not Implemented
**File:** `apps/web/src/app/dashboard/provider/earnings/page.tsx`
**Severity:** Low — Feature gap
**Description:** `TODO: Export logic` — The earnings export button (CSV/PDF) is rendered in the UI but has no implementation.
**Impact:** Providers cannot export their earnings history for accounting or tax purposes.

---

#### L-05: Notification Flood — No Event Deduplication
**File:** `services/control-api/internal/api/notifications.go`
**Severity:** Low — UX
**Description:** Multiple rapid follow/unfollow actions or system retries can create duplicate notifications without deduplication logic. There is no idempotency check on notification creation.
**Impact:** Users receive spam-like duplicate notifications for the same event.

---

#### L-06: GeoIP Database Requires Manual Update
**File:** `services/edge-gateway/src/security/`
**Severity:** Low — Operational
**Description:** The MaxMind GeoLite2 database is loaded at startup from a file path. There is no automated refresh mechanism. MaxMind releases database updates twice per month.
**Impact:** GeoIP accuracy degrades over time; new IP ranges won't be classified correctly without manual database file replacement.

---

#### L-07: Admin Static Credentials in Environment Variables
**File:** `.env.example` — `ADMIN_ACCOUNT_*_USERNAME/PASSWORD/ROLE`
**Severity:** Low — Security posture
**Description:** Admin accounts are defined as static environment variables (up to 3 accounts). There is no admin account rotation mechanism, MFA enforcement, or session invalidation for compromised admin credentials.
**Impact:** Compromised admin credentials provide persistent access until the service is redeployed with new env vars.

---

## 7. Recommendations & Implementation Plan

### Phase 1: Critical Fixes — Incomplete Payment Paths
**Priority:** Immediate (block all releases until resolved)
**Effort:** 2–3 weeks
**Goal:** Ensure all payment paths actually transfer funds.

#### 1.1 Fix Circle Pool Payment Execution
**File:** `services/control-api/internal/api/circle_pool.go`
**Action:** Replace the TODO with a call to the billing service's `TransferToProvider()` function (same as used in order settlement). Wire it through the wallet ledger system.
**Acceptance Criteria:** After a circle lease completes, provider's wallet balance increases by the correct net amount (after platform fee deduction).

#### 1.2 Fix Dispute Blockchain Settlement
**File:** `services/control-api/internal/api/dispute_jury.go`
**Action:** After jury vote finalizes the outcome, call `oracle.EmergencyRefund()` (buyer wins) or `oracle.SettleEscrow()` (seller wins) from the Solana oracle client. Persist the transaction hash.
**Acceptance Criteria:** After dispute resolution, on-chain escrow account status equals `Refunded` or `Settled`; funds appear in recipient wallet.

#### 1.3 Fix Milestone Wallet Credit
**File:** `services/control-api/internal/api/milestones.go`
**Action:** On milestone completion, call `walletService.Credit(userID, amount, "milestone")` and create a `WalletLedgerEntry` with type `earning`.
**Acceptance Criteria:** User wallet balance increases by correct amount when milestone is marked complete.

#### 1.4 Wire ZK Settlement to Blockchain
**File:** `services/control-api/internal/billing/zk_aggregator.go`
**Action:** Implement `SubmitZKSettlement` as a Solana instruction call within the oracle client. Connect it to the aggregator's proof submission.
**Acceptance Criteria:** ZK proofs trigger on-chain settlement; settlement confirmed via transaction hash in DB.

#### 1.5 Guard Against SOL Price Division-by-Zero
**File:** `services/control-api/internal/api/orders.go`
**Action:**
```go
solPrice, err := prices.GetSOLPrice(ctx)
if err != nil || solPrice <= 0 {
    c.JSON(http.StatusServiceUnavailable, gin.H{"error": "price feed unavailable"})
    return
}
```
**Acceptance Criteria:** Order creation returns 503 (not panic) when all price feeds fail.

---

### Phase 2: Security Hardening
**Priority:** High (before mainnet launch)
**Effort:** 2–3 weeks
**Goal:** Close security gaps in payment authorization and fund handling.

#### 2.1 Enforce Multisig Threshold in Billing Service
**File:** `services/control-api/internal/core/services/billing_service.go`
**Action:** Replace single-signature verification with N-of-M threshold check. Fetch `min_oracle_signatures` from `ProgramState` account (or config). Require that many valid signatures from the known oracle set before recording earnings.
**Acceptance Criteria:** Usage reports with fewer than threshold signatures are rejected with a structured error.

#### 2.2 Verify Escrow PDA On-Chain Before Recording
**File:** `services/control-api/internal/api/orders.go`
**Action:** After deriving PDA, call `oracle.GetAccountInfo(pda)` and deserialize the `Escrow` account. Verify `buyer`, `seller`, `amount` match the order before marking the order as escrow-locked.
**Acceptance Criteria:** Order payment initiation fails gracefully if on-chain PDA doesn't match expected values.

#### 2.3 Wait for Transaction Finality Before Marking Batch Complete
**File:** `services/control-api/internal/solana/settlement.go`
**Action:** After submitting the transaction, poll `GetSignatureStatuses()` with `Finalized` commitment level. Retry up to N times with exponential backoff. Only update `BatchPayout.Status=completed` after finality confirmed.
**Acceptance Criteria:** Batch settlement records reflect actual on-chain finality; no false-positive "completed" batches.

#### 2.4 Include Wallet Address in Idempotency Key
**File:** `services/control-api/internal/billing/batch_payout.go`
**Action:** Change idempotency key derivation:
```go
h.Write([]byte(payout.WalletAddress)) // add wallet address to hash input
```
**Acceptance Criteria:** Same sessions with different wallet address produce different idempotency key; retry sends to correct wallet.

#### 2.5 Fix Spending Limits Default Semantics
**File:** `services/control-api/internal/models/wallet.go`
**Action:** Default new wallets to `LimitsEnabled=true` with `TrustTierNew` limits. Document clearly that `LimitsEnabled=false` means "unlimited" (premium tier override only).
**Acceptance Criteria:** New user wallets are rate-limited from day one; premium users can disable limits after KYC.

---

### Phase 3: Data Integrity
**Priority:** High
**Effort:** 1–2 weeks
**Goal:** Fix edge cases causing incorrect data states.

#### 3.1 Fix KYC Re-verification for Late Wallet Linking
**File:** `services/control-api/internal/api/kyc.go`
**Action:** Add a cron worker or triggered job that re-checks pending KYC users who have since linked wallets. Also add a `POST /kyc/recheck` endpoint for users to trigger revalidation.
**Acceptance Criteria:** User who links wallet after KYC webhook fires gets correctly promoted to `Verified` tier.

#### 3.2 Make Wallet Creation Fully Transactional
**File:** `services/control-api/internal/api/wallet.go`
**Action:** Wrap wallet creation in a `db.Transaction()` block with `SELECT ... FOR UPDATE` on the user profile to serialize concurrent creation attempts.
**Acceptance Criteria:** Concurrent wallet creation requests for the same user always result in exactly one wallet.

#### 3.3 Add `pending_payment` Order Status
**File:** `services/control-api/internal/models/order.go`, `internal/api/orders.go`
**Action:** Add `OrderStatusPendingPayment` between `pending` and `active`. Set it after escrow initiation; only move to `active` after session is provisioned.
**Acceptance Criteria:** Failed payment transactions leave order in `pending_payment`; only confirmed payments produce active sessions.

---

### Phase 4: Robustness
**Priority:** Medium
**Effort:** 2 weeks
**Goal:** Improve system resilience and operational reliability.

#### 4.1 Persist Circuit Breaker State to Redis
**File:** `services/control-api/internal/billing/worker.go`
**Action:** Store circuit breaker `{state, trip_count, last_trip_time}` in Redis with a key like `circuit:payout:state`. On startup, restore from Redis.
**Acceptance Criteria:** Service restart during a payment outage does not immediately retry and worsen the failure.

#### 4.2 Add Cascade Deletes for Social Records
**File:** Database migrations
**Action:** Add `ON DELETE CASCADE` for `friendships`, `follows`, `notifications`, `feed_events` foreign keys to `profiles`. Create a new migration file.
**Acceptance Criteria:** Deleting a user removes all their social graph records automatically.

#### 4.3 Automated Stale Node Cleanup Worker
**File:** `services/control-api/internal/worker/`
**Action:** Add a background worker that runs hourly and marks nodes `offline` if `last_heartbeat < NOW() - 30 minutes`, and archives/soft-deletes nodes `offline` for more than 7 days.
**Acceptance Criteria:** Explorer map shows accurate active node counts; stale nodes not visible to consumers.

#### 4.4 Notification Deduplication
**File:** `services/control-api/internal/api/notifications.go`
**Action:** Before inserting a notification, check for an existing unread notification of the same `(user_id, type, actor_id)` within the last 60 seconds. Use an upsert with conflict on these fields.
**Acceptance Criteria:** Rapid follow/unfollow cycles produce at most one notification per user pair.

#### 4.5 Upgrade Event Queue to Redis Streams + Consumer Groups
**File:** `services/control-api/internal/events/redis_queue.go`
**Action:** Replace `LPUSH/RPOP` pattern with `XADD/XREADGROUP`. Use `XACK` for explicit acknowledgment after successful processing.
**Acceptance Criteria:** Events are not lost on consumer crash; events are replayed on restart from last acknowledged position.

---

### Phase 5: Feature Completion
**Priority:** Medium-Low
**Effort:** 2–3 weeks
**Goal:** Complete partially-implemented features that are visible to users.

#### 5.1 Implement Provider Earnings Export
**File:** `apps/web/src/app/dashboard/provider/earnings/page.tsx`, `services/control-api/internal/api/analytics.go`
**Action:** Add `GET /analytics/earnings/export?format=csv&from=X&to=Y` endpoint. Frontend downloads file via `window.location.href`.
**Acceptance Criteria:** Provider can download CSV of earnings with columns: date, session_id, bandwidth_gb, gross_sol, fee_sol, net_sol, status.

#### 5.2 Real Response Time Calculation
**File:** `services/control-api/internal/api/listing_social.go`
**Action:** Calculate average response time from `messages` table: `AVG(created_at - (previous message created_at where sender=provider))` for conversations where the provider responded.
**Acceptance Criteria:** Response time shown on listing cards reflects actual average from the last 30 days of conversations.

#### 5.3 Implement GeoIP Database Auto-Update
**File:** `services/edge-gateway/` (new component or Docker volume update mechanism)
**Action:** Add a weekly cron job or startup script that downloads the latest GeoLite2-Country.mmdb from MaxMind API (requires license key) and hot-reloads it without service restart.
**Acceptance Criteria:** GeoIP database is never more than 7 days old in production.

#### 5.4 Admin MFA and Session Management
**File:** `services/control-api/internal/api/admin.go`
**Action:** Add TOTP 2FA for admin login. Store TOTP secrets in DB with proper encryption. Add admin session invalidation endpoint.
**Acceptance Criteria:** Admin login requires 6-digit TOTP code; compromised admin sessions can be revoked without redeployment.

#### 5.5 PagerDuty / Email Alert Integration
**File:** `services/control-api/internal/health/system.go`, `internal/alerts/channels.go`
**Action:** Implement `AlertAdminEmail()` and `AlertPagerDuty()` in the alert channels. Configure via `PAGERDUTY_ROUTING_KEY` env var.
**Acceptance Criteria:** Critical health events trigger PagerDuty incident and admin email within 60 seconds.

---

## 8. Conclusion

ProxyHubb is an architecturally ambitious and technically sophisticated platform that combines the right technologies for each layer of the stack. The overall design — decentralized escrow payments, high-performance Rust proxy engine, rich social layer, and DAO governance — represents a production-grade vision for a decentralized bandwidth marketplace.

**The core infrastructure is solid:** The multi-tier session cache, Ed25519-signed usage events, multisig oracle, velocity guards, and NATS-backed event system are production-quality design choices. The separation of concerns between Go (business logic) and Rust (network performance) is well-executed.

**The critical gaps are in payment completion paths:** Four payment-related code paths have explicit TODOs that make them non-functional. These are not design flaws — the architecture is correct — but incomplete implementations that must be finished before any financial operations can be trusted. Fixing these five critical issues (C-01 through C-05) is the single most important engineering priority.

**Security is partially hardened:** The on-chain multisig is well-designed but not fully enforced off-chain. Transaction finality, PDA verification, and spending limit defaults need to be tightened before mainnet.

**The recommendation is clear:** Complete the five critical payment paths immediately, then work through security hardening and data integrity fixes before any mainnet launch. The platform's foundation is strong enough to support these improvements without architectural changes.

---

*Report generated: 2026-03-30*
*Codebase analyzed: `f:\project\proxyhubb\`*
*Analysis performed by: Claude Code (Sonnet 4.6)*
