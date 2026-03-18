# ProxyHub Platform Architecture Analysis Report

**Report Date:** March 15, 2026  
**Subject:** Web Platform vs Provider CLI - Architecture, Functions & Differences  
**Author:** AI Assistant  

---

## Executive Summary

ProxyHub is a **decentralized proxy marketplace** with two distinct but complementary components:

1. **Web Platform** (`apps/web/`) - Consumer/Buyer Interface
2. **Provider CLI** (`services/control-api/cmd/provider-cli/`) - Provider/Seller Software

This report analyzes both systems, their architectures, data flows, and key differences.

---

## Part 1: The ProxyHub Web Platform

### 1.1 What is the Web Platform?

The **Web Platform** is the **consumer-facing application** where users:
- Purchase proxy access
- Manage proxy sessions (rotation/sticky)
- Monitor usage and bandwidth
- View marketplace listings
- Manage wallet and payments

### 1.2 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        WEB PLATFORM ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐               │
│   │   Web App    │────▶│   Next.js    │────▶│  React UI    │               │
│   │   (Browser)  │◀────│   (Frontend) │◀────│  (Dashboard) │               │
│   └──────────────┘     └──────┬───────┘     └──────────────┘               │
│                               │                                              │
│                               │ API Calls                                    │
│                               ▼                                              │
│   ┌──────────────────────────────────────────────────────────────┐          │
│   │                    CONTROL API (Go/Gin)                       │          │
│   │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────┐  │          │
│   │  │  Session   │ │   Wallet   │ │   Orders   │ │  Explorer │  │          │
│   │  │ Management │ │ Management │ │ Management │ │    API    │  │          │
│   │  └────────────┘ └────────────┘ └────────────┘ └───────────┘  │          │
│   └──────────────────────────┬───────────────────────────────────┘          │
│                              │                                               │
│         ┌────────────────────┼────────────────────┐                         │
│         │                    │                    │                         │
│         ▼                    ▼                    ▼                         │
│   ┌──────────┐        ┌──────────┐       ┌──────────────┐                  │
│   │ PostgreSQL│        │  Redis   │       │  Edge Gateway │                  │
│   │  (Data)   │        │ (Cache)  │       │  (Proxy Port) │                  │
│   └──────────┘        └──────────┘       └──────────────┘                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Key Components

#### Frontend (`apps/web/`)
- **Framework:** Next.js 14 with App Router
- **Styling:** Tailwind CSS
- **State Management:** React Query + Zustand
- **Key Pages:**
  - `/dashboard` - User dashboard
  - `/explorer` - Node marketplace/map
  - `/wallet` - Balance and transactions
  - `/sessions` - Active proxy sessions
  - `/buy` - Purchase proxy access

#### Backend API (`services/control-api/`)
- **Framework:** Go with Gin
- **Database:** PostgreSQL (via Supabase)
- **Cache:** Redis
- **Key Modules:**
  - Session management
  - Wallet/ledger management
  - Order processing
  - Node registration
  - Billing and payouts

### 1.4 User Flow (Consumer)

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONSUMER USER FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. SIGN UP                                                      │
│     User creates account via web app                            │
│     ↓                                                            │
│  2. FUND WALLET                                                  │
│     Deposit SOL via Solana blockchain                           │
│     ↓                                                            │
│  3. PURCHASE PROXY                                               │
│     Select session type (rotating/sticky)                       │
│     Select bandwidth amount                                     │
│     ↓                                                            │
│  4. GET PROXY CREDENTIALS                                        │
│     Receive: host:port + username:password                      │
│     ↓                                                            │
│  5. CONFIGURE PROXY                                              │
│     Set in browser, curl, or application                        │
│     ↓                                                            │
│  6. START BROWSING                                               │
│     Traffic routed through Edge Gateway → Provider Node         │
│     ↓                                                            │
│  7. MONITOR USAGE                                                │
│     View bandwidth consumption in dashboard                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.5 Core Functions

| Function | Description | User Type |
|----------|-------------|-----------|
| **Session Management** | Create/monitor proxy sessions | Consumer |
| **Wallet Management** | Deposit/withdraw SOL, view transactions | Consumer |
| **Order Processing** | Purchase proxy access packages | Consumer |
| **Node Explorer** | View available nodes on map | Consumer |
| **Usage Analytics** | Track bandwidth consumption | Consumer |
| **Provider Dashboard** | View earnings, manage nodes | Provider |

---

## Part 2: The Provider CLI

### 2.1 What is the Provider CLI?

The **Provider CLI** is the **command-line software** that providers run to:
- Connect their computer to the Edge Gateway
- Share internet bandwidth
- Serve proxy requests from consumers
- Earn SOL tokens for provided bandwidth

### 2.2 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PROVIDER CLI ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────┐          │
│   │                    PROVIDER COMPUTER                          │          │
│   │                                                              │          │
│   │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │          │
│   │  │   CLI Cmd    │───▶│   Config     │───▶│    Tunnel    │   │          │
│   │  │   (cobra)    │    │   (viper)    │    │   Client     │   │          │
│   │  └──────────────┘    └──────────────┘    └──────┬───────┘   │          │
│   │                                                  │           │          │
│   │                         ┌────────────────────────┤           │          │
│   │                         │                        │           │          │
│   │                         ▼                        ▼           │          │
│   │                ┌──────────────┐          ┌──────────────┐   │          │
│   │                │  Heartbeat   │          │   Handler    │   │          │
│   │                │   Manager    │          │   (proxy)    │   │          │
│   │                └──────────────┘          └──────┬───────┘   │          │
│   │                                                 │            │          │
│   │                                                 ▼            │          │
│   │                                        ┌──────────────┐     │          │
│   │                                        │   Internet   │     │          │
│   │                                        │   (Target)   │     │          │
│   │                                        └──────────────┘     │          │
│   │                                                             │          │
│   └─────────────────────────────┬───────────────────────────────┘          │
│                                 │                                            │
│                                 │ TCP + TLS + Yamux                          │
│                                 ▼                                            │
│   ┌──────────────────────────────────────────────────────────────┐          │
│   │                    EDGE GATEWAY                               │          │
│   │                      (Rust)                                   │          │
│   │                   Port 4000 (Tunnel)                          │          │
│   └─────────────────────────────┬───────────────────────────────┘          │
│                                 │                                            │
│                                 │ Routes to Consumers                        │
│                                 ▼                                            │
│   ┌──────────────────────────────────────────────────────────────┐          │
│   │                    CONSUMER REQUESTS                          │          │
│   └──────────────────────────────────────────────────────────────┘          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Key Components

#### Tunnel Client (`internal/tunnel/client.go`)
- **Protocol:** Yamux over TCP/TLS
- **Connection:** Persistent to Edge Gateway:4000
- **Functions:**
  - JWT authentication
  - Capability declaration
  - Heartbeat sending (every 30s)
  - Stream multiplexing

#### Proxy Handler (`internal/proxy/handler.go`)
- **Protocol:** HTTP CONNECT
- **Security:** Blocks private IPs, enforces port whitelist
- **Functions:**
  - Accept CONNECT commands
  - Forward to target websites
  - Track bandwidth usage

#### Heartbeat Manager (`internal/tunnel/heartbeat.go`)
- **Frequency:** Every 30 seconds
- **Payload:** Active connections, bandwidth usage, system stats
- **Purpose:** Keep connection alive, report health

### 2.4 Provider Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     PROVIDER USER FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. INSTALL CLI                                                  │
│     Download and install provider-cli                           │
│     ↓                                                            │
│  2. CONFIGURE                                                    │
│     Run: provider-cli wizard                                    │
│     Enter API key and JWT token                                 │
│     ↓                                                            │
│  3. REGISTER NODE                                                │
│     Run: provider-cli node register                             │
│     Node appears in database                                    │
│     ↓                                                            │
│  4. START NODE                                                   │
│     Run: provider-cli node start                                │
│     ↓                                                            │
│  5. CONNECT TO GATEWAY                                           │
│     TCP → TLS → Yamux session                                   │
│     Send AUTH + CAPABILITY                                      │
│     ↓                                                            │
│  6. SERVE TRAFFIC                                                │
│     Accept proxy requests from consumers                        │
│     Forward to target websites                                  │
│     ↓                                                            │
│  7. EARN REWARDS                                                 │
│     Bandwidth usage tracked                                     │
│     SOL paid out periodically                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.5 CLI Commands Reference

| Command | Purpose | When Used |
|---------|---------|-----------|
| `wizard` | Interactive setup | First time setup |
| `config set` | Set configuration | Update settings |
| `config show` | View configuration | Verify settings |
| `node register` | Register new node | Adding new node |
| `node start` | Start serving traffic | Daily operation |
| `node stop` | Stop serving traffic | Maintenance |
| `node status` | Check node health | Monitoring |
| `doctor` | Run diagnostics | Troubleshooting |
| `service install` | Install as system service | Production setup |

---

## Part 3: Side-by-Side Comparison

### 3.1 Core Differences

| Aspect | Web Platform | Provider CLI |
|--------|--------------|--------------|
| **Target User** | Consumers (Buyers) | Providers (Sellers) |
| **Primary Function** | Purchase and use proxies | Sell bandwidth via proxies |
| **Interface Type** | Web Application (Browser) | Command Line Interface |
| **Who Runs It** | ProxyHubb team deploys | Individual providers run |
| **Money Flow** | Pays SOL for access | Earns SOL for bandwidth |
| **Connection Direction** | Outbound (to Edge Gateway) | Outbound (to Edge Gateway) |
| **Protocol** | HTTPS (REST API) | Yamux over TCP/TLS |
| **Port Used** | 443 (standard HTTPS) | 4000 (tunnel port) |

### 3.2 Architecture Differences

```
┌─────────────────────────────────────────────────────────────────┐
│              ARCHITECTURE COMPARISON                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   WEB PLATFORM                        PROVIDER CLI              │
│   ─────────────                       ────────────              │
│                                                                  │
│   ┌─────────────┐                     ┌─────────────┐          │
│   │   Browser   │                     │   Terminal  │          │
│   │  (React)    │                     │   (CLI)     │          │
│   └──────┬──────┘                     └──────┬──────┘          │
│          │                                    │                 │
│          │ HTTPS                              │ TCP+TLS+Yamux   │
│          ▼                                    ▼                 │
│   ┌─────────────┐                     ┌─────────────┐          │
│   │ Control API │◄───────────────────▶│ Edge Gateway│          │
│   │   (Go)      │    Manages nodes    │   (Rust)    │          │
│   └─────────────┘                     └─────────────┘          │
│          │                                    │                 │
│          │ Manages sessions                   │ Accepts streams │
│          ▼                                    ▼                 │
│   ┌─────────────┐                     ┌─────────────┐          │
│   │  PostgreSQL │                     │  Internet   │          │
│   └─────────────┘                     │  (Targets)  │          │
│                                       └─────────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Data Flow Comparison

#### Web Platform Data Flow
```
User Action → React Component → API Call → Control API → Database
     ↑                                                    ↓
     └────────────── UI Update ← Response ←──────────────┘
```

#### Provider CLI Data Flow
```
CLI Start → Connect TCP → TLS Handshake → Yamux Session
                                    ↓
                              AUTH + CAPABILITY
                                    ↓
                         Accept Streams ←── Consumer Requests
                                    ↓
                              Forward to Target
                                    ↓
                         Return Response ←── Target Response
```

### 3.4 Technical Stack Comparison

| Component | Web Platform | Provider CLI |
|-----------|--------------|--------------|
| **Language** | TypeScript/JavaScript | Go |
| **Framework** | Next.js 14 | Cobra (CLI) |
| **Styling** | Tailwind CSS | N/A (CLI) |
| **State Management** | React Query, Zustand | Viper (config) |
| **Networking** | HTTP/HTTPS (fetch/axios) | Raw TCP + Yamux |
| **Security** | JWT in HTTP headers | JWT in Yamux stream |
| **Database** | PostgreSQL via API | N/A (stateless) |
| **Logging** | Browser console | Zap (structured) |

### 3.5 User Role Comparison

| Aspect | Consumer (Web) | Provider (CLI) |
|--------|----------------|----------------|
| **Goal** | Browse anonymously | Earn SOL |
| **Action** | Configure proxy settings | Run software |
| **Interaction** | Click buttons, fill forms | Type commands |
| **Visibility** | Sees dashboard, stats | Sees logs, metrics |
| **Control** | Starts/stops sessions | Starts/stops node |
| **Earnings** | Pays for usage | Earns from usage |

---

## Part 4: How They Work Together

### 4.1 The Complete System Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    COMPLETE PROXYHUB ECOSYSTEM                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   CONSUMER SIDE                    PLATFORM                    PROVIDER SIDE│
│   ─────────────                   ─────────                   ─────────────│
│                                                                              │
│   ┌──────────┐                  ┌──────────┐                  ┌──────────┐  │
│   │   Web    │                  │  Control │                  │ Provider │  │
│   │ Platform │◄────────────────▶│   API    │◄────────────────▶│   CLI    │  │
│   │          │   1. Buy Proxy   │ (Go)     │   2. Register    │  (Go)    │  │
│   └────┬─────┘                  └────┬─────┘                  └────┬─────┘  │
│        │                            │                             │        │
│        │                            │                             │        │
│        │ 3. Get Credentials         │                             │        │
│        │    (host:port:user:pass)   │                             │        │
│        ▼                            │                             ▼        │
│   ┌──────────┐                      │                       ┌──────────┐  │
│   │  Browser │                      │                       │ Provider │  │
│   │  Proxy   │                      │                       │  Node    │  │
│   │ Settings │                      │                       │ (User's  │  │
│   └────┬─────┘                      │                       │ Computer)│  │
│        │                            │                       └────┬─────┘  │
│        │                            │                            │        │
│        │ 4. HTTP CONNECT            │                            │        │
│        ▼                            │                            ▼        │
│   ┌──────────┐                      │                       ┌──────────┐  │
│   │  Edge    │◄─────────────────────┴──────────────────────▶│  Edge    │  │
│   │ Gateway  │                 5. Yamux Tunnel              │ Gateway  │  │
│   │ (Port    │◄────────────────────────────────────────────▶│ (Port    │  │
│   │  3128)   │                                              │  4000)   │  │
│   └────┬─────┘                                              └──────────┘  │
│        │                                                                   │
│        │ 6. Forward Request                                                │
│        ▼                                                                   │
│   ┌──────────┐                                                             │
│   │ Target   │                                                             │
│   │ Website  │                                                             │
│   └──────────┘                                                             │
│                                                                              │
│   FLOW:                                                                      │
│   1. Consumer buys proxy on Web Platform                                     │
│   2. Provider registers node via CLI                                         │
│   3. Consumer gets proxy credentials                                         │
│   4. Consumer configures browser with proxy                                  │
│   5. CLI connects to Edge Gateway, creates tunnel                            │
│   6. Consumer traffic flows: Browser → Edge Gateway → Provider → Target      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Communication Patterns

#### Consumer ↔ Platform (Web)
- **Protocol:** HTTPS/JSON REST API
- **Authentication:** JWT in HTTP Authorization header
- **Frequency:** Per-request (stateless)
- **Data:** Sessions, wallet, orders, analytics

#### Provider ↔ Platform (CLI)
- **Protocol:** Yamux multiplexed over TCP+TLS
- **Authentication:** JWT in initial handshake
- **Frequency:** Persistent connection + heartbeats
- **Data:** Node registration, heartbeats, traffic forwarding

### 4.3 Shared Resources

| Resource | Web Platform Uses | Provider CLI Uses |
|----------|-------------------|-------------------|
| **Control API** | CRUD operations on sessions | Node registration |
| **Edge Gateway** | Routes consumer traffic | Accepts provider connections |
| **PostgreSQL** | Stores all data | Indirect (via API for registration) |
| **Redis** | Session cache, rate limiting | Heartbeat storage |
| **Solana Blockchain** | Payments, wallet | Earnings, payouts |

---

## Part 5: Analysis & Insights

### 5.1 Strengths

#### Web Platform Strengths
- **User-Friendly:** Intuitive UI for non-technical users
- **Feature-Rich:** Dashboard, analytics, marketplace
- **Secure:** HTTPS, JWT, Row-Level Security
- **Scalable:** Next.js + CDN for global access

#### Provider CLI Strengths
- **Efficient:** Minimal resource usage
- **Automated:** Can run as background service
- **Protocol-Native:** Direct Yamux for performance
- **Cross-Platform:** Go compiles for all OSes

### 5.2 Design Philosophy Differences

| Web Platform | Provider CLI |
|--------------|--------------|
| **User Experience First** | **Performance First** |
| Rich interactions, visuals | Fast, efficient, automated |
| High-level abstractions | Low-level protocol control |
| Many features, options | Focused, minimal surface |
| Browser-constrained | System-level access |

### 5.3 Security Model Comparison

#### Web Platform Security
```
User ←──HTTPS+JWT──→ Cloudflare ←──HTTPS──→ Next.js ←──API──→ Control API
                                      ↓
                              Row-Level Security (RLS)
```

#### Provider CLI Security
```
Provider Computer ←──TCP+TLS──→ Edge Gateway
                         ↓
                   JWT Auth + Capability Limits
                         ↓
                   Target Validation (blocks private IPs)
```

### 5.4 Economic Model

```
┌─────────────────────────────────────────────────────────────┐
│                    ECONOMIC FLOW                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   CONSUMER                    PROVIDER                       │
│      │                           │                          │
│      │ 1. Deposit SOL            │                          │
│      ▼                           │                          │
│   ┌─────────┐                    │                          │
│   │ Wallet  │                    │                          │
│   │ (SOL)   │                    │                          │
│   └────┬────┘                    │                          │
│        │                         │                          │
│        │ 2. Pay for Proxy        │                          │
│        │    (per GB used)        │                          │
│        ▼                         │                          │
│   ┌─────────┐    3. Track Usage  │                          │
│   │ Billing │◀───────────────────│── Provider CLI serves    │
│   │ Engine  │                    │   traffic, reports usage   │
│   └────┬────┘                    │                          │
│        │                         │                          │
│        │ 4. Distribute Earnings  │                          │
│        ▼                         ▼                          │
│   ┌─────────────────────────────────┐                       │
│   │         Treasury System          │                       │
│   │  (Batch payouts every 24 hours)  │                       │
│   └─────────────────────────────────┘                       │
│                                      │                      │
│                                      ▼                      │
│                              Provider Wallet (SOL)          │
│                                                              │
│   PLATFORM FEE: 10-20% of transaction                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 6: Summary Table

| Characteristic | Web Platform | Provider CLI |
|----------------|--------------|--------------|
| **What** | Web app for buying proxies | CLI for selling bandwidth |
| **Who** | Consumers | Providers |
| **Where** | Browser | Terminal/Command line |
| **How** | HTTPS REST API | Yamux over TCP+TLS |
| **Money** | Pays SOL | Earns SOL |
| **Goal** | Anonymous browsing | Passive income |
| **Tech** | Next.js, React, TypeScript | Go, Cobra, Yamux |
| **State** | Stateful (sessions) | Stateless (reconnects) |
| **UI** | Graphical, visual | Text-based, logs |
| **Deployment** | Centralized (ProxyHub) | Distributed (User computers) |

---

## Conclusion

The **ProxyHub ecosystem** consists of two complementary systems:

1. **Web Platform** - The **marketplace interface** where consumers discover, purchase, and manage proxy services. It prioritizes user experience and provides rich visual feedback.

2. **Provider CLI** - The **infrastructure software** that enables providers to contribute bandwidth to the network. It prioritizes efficiency, reliability, and automation.

**The Relationship:**
- Web Platform attracts **consumers** and processes **payments**
- Provider CLI attracts **providers** and enables **service delivery**
- Together they create a **two-sided marketplace** for decentralized proxy services

**The Edge Gateway** serves as the critical bridge between them, routing consumer requests to available provider nodes.

This architecture successfully separates concerns:
- Consumer experience is optimized through the web app
- Provider operations are streamlined through the CLI
- Both systems work together to create a functioning proxy marketplace
