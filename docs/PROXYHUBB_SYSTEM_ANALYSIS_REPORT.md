# ProxyHubb System Analysis Report

**Generated**: March 14, 2026  
**Version**: 1.0.0  
**Classification**: Internal Documentation

---

## Executive Summary

ProxyHubb is a sophisticated decentralized proxy marketplace platform built on Solana blockchain. The system enables users to buy and sell proxy bandwidth through a trustless, blockchain-verified infrastructure. The architecture consists of multiple microservices, blockchain integrations, real-time pricing engines, and comprehensive monitoring.

### Key Statistics
- **Total Services**: 11+ microservices
- **Primary Languages**: Go (Control API), Rust (Edge Gateway), TypeScript/React (Frontend)
- **Blockchain**: Solana (Devnet/Mainnet)
- **Database**: PostgreSQL 16 with Redis caching
- **Message Bus**: NATS JetStream
- **Monitoring**: Prometheus + Grafana

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PROXYHUBB PLATFORM                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │   Web App    │    │  Admin Panel │    │   Provider   │                  │
│  │  (Next.js)   │    │  (Next.js)   │    │     CLI      │                  │
│  │   :3000      │    │   :3002      │    │              │                  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                  │
│         │                   │                   │                           │
│         └───────────────────┼───────────────────┘                           │
│                             │                                               │
│                             ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      CONTROL API (Go/Gin)                           │   │
│  │                         Port: 8081                                │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐  │   │
│  │  │   Auth   │ │ Sessions │ │  Wallet  │ │Provider  │ │Billing  │  │   │
│  │  │   API    │ │   API    │ │   API    │ │   API    │ │  API    │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └─────────┘  │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐  │   │
│  │  │Explorer  │ │  KYC     │ │Matching  │ │Treasury  │ │Pricing  │  │   │
│  │  │   API    │ │   API    │ │ Engine   │ │ Engine   │ │ Oracle  │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └─────────┘  │   │
│  └────────────────────────────────┬──────────────────────────────────┘   │
│                                   │                                        │
│                                   ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     EDGE GATEWAY (Rust)                             │   │
│  │                    Ports: 3128 (Proxy), 8090 (API)                 │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐              │   │
│  │  │  Tunnel  │ │   Auth   │ │  Router  │ │ Circuit  │              │   │
│  │  │  Server  │ │Handler   │ │ (ML+Geo) │ │ Breaker  │              │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘              │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                          │   │
│  │  │Blockchain│ │  Pricing │ │  DDoS    │                          │   │
│  │  │  Stream  │ │ Engine   │ │Protection│                          │   │
│  │  └──────────┘ └──────────┘ └──────────┘                          │   │
│  └────────────────────────────────┬──────────────────────────────────┘   │
│                                   │                                        │
├───────────────────────────────────┼──────────────────────────────────────┤
│                                   │                                        │
│         ┌─────────────────────────┼─────────────────────────┐             │
│         │                         ▼                         │             │
│  ┌──────┴──────┐  ┌──────────┐  ┌──────┐  ┌──────────┐    │             │
│  │ PostgreSQL  │  │  Redis   │  │ NATS │  │Prometheus│    │             │
│  │    :5432    │  │  :6379   │  │:4222 │  │  :9091   │    │             │
│  └─────────────┘  └──────────┘  └──────┘  └──────────┘    │             │
│         │                  │         │           │          │             │
│         └──────────────────┴─────────┴───────────┘          │             │
│                              │                              │             │
│                              ▼                              │             │
│  ┌────────────────────────────────────────────────────────┐│             │
│  │                    SOLANA BLOCKCHAIN                    ││             │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   ││             │
│  │  │ Program  │ │ Treasury │ │Provider  │ │ Pricing  │   ││             │
│  │  │   ID     │ │  Wallet  │ │Registry  │ │  Oracle  │   ││             │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   ││             │
│  └────────────────────────────────────────────────────────┘│             │
│                                                            │             │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Microservices Architecture

### 2.1 Control API (Go)
**Location**: `services/control-api/`  
**Language**: Go 1.24  
**Framework**: Gin  
**Port**: 8080 (internal), 8081 (external)

#### Core Modules

| Module | Purpose | Key Files |
|--------|---------|-----------|
| **API Layer** | HTTP handlers, routing | `internal/api/*.go` |
| **Core Services** | Business logic, domain models | `internal/core/` |
| **Database** | PostgreSQL repository layer | `internal/db/` |
| **Blockchain** | Solana integration | `internal/solana/` |
| **Billing** | Payment processing, aggregation | `internal/billing/` |
| **Treasury** | SOL treasury management | `internal/treasury/` |
| **Workers** | Background job processing | `internal/worker/` |
| **Security** | MFA, rate limiting, audit | `internal/security/` |
| **Pricing** | Oracle price feeds | `internal/pricing/` |
| **Matching** | Provider-user matching engine | `internal/matching/` |

#### Key Features
- **Authentication**: JWT-based with OAuth (Google, GitHub)
- **Authorization**: Role-based (user, provider, admin)
- **API Documentation**: Swagger/OpenAPI
- **Rate Limiting**: Advanced per-endpoint limits
- **Circuit Breaker**: Fail-fast for external services
- **Tracing**: OpenTelemetry/Jaeger integration

### 2.2 Edge Gateway (Rust)
**Location**: `services/edge-gateway/`  
**Language**: Rust 1.85+  
**Port**: 3128 (SOCKS5/HTTP Proxy), 8090 (Management API)

#### Core Modules

| Module | Purpose | Key Files |
|--------|---------|-----------|
| **Tunnel Server** | Provider connection handling | `src/tunnel.rs` |
| **Proxy Handler** | HTTP/HTTPS proxy logic | `src/proxy/` |
| **Auth Handler** | Session authentication | `src/auth.rs` |
| **ML Router** | Intelligent provider selection | `src/routing/ml_router.rs` |
| **Circuit Breaker** | Failure isolation | `src/circuitbreaker.rs` |
| **Blockchain** | Direct Solana streaming | `src/blockchain/` |
| **Pricing** | Real-time price awareness | `src/pricing/` |
| **Security** | DDoS, geo-blocking, WAF | `src/security/` |
| **Registry** | Provider node management | `src/registry/` |

#### Key Features
- **Protocol Support**: HTTP/HTTPS, SOCKS5, WebSocket
- **ML Routing**: ONNX-based provider scoring
- **Security**: DDoS protection, DNS rebinding protection, domain blocklist
- **Performance**: Lock-free data structures, connection pooling
- **Blockchain**: Direct gRPC to Solana (no Control API hop)

### 2.3 Web Frontend (Next.js)
**Location**: `apps/web/`  
**Framework**: Next.js 15 + React  
**Port**: 3000

#### Features
- User dashboard and proxy management
- Wallet integration (Solana)
- Provider marketplace browsing
- Session management
- Real-time updates via WebSocket

### 2.4 Admin Panel (Next.js)
**Location**: `apps/admin/`  
**Framework**: Next.js + React  
**Port**: 3002

#### Features
- System administration
- User/provider management
- Analytics and monitoring
- KYC verification workflow
- Treasury oversight

---

## 3. Infrastructure Services

### 3.1 PostgreSQL
**Version**: 16-alpine  
**Port**: 5432

#### Database Features
- Row Level Security (RLS) enabled
- Soft deletes with `deleted_at` columns
- Partitioning for large tables
- Read replicas support

### 3.2 Redis
**Version**: 7-alpine  
**Port**: 6379

#### Usage
- Session caching
- Rate limiting counters
- Real-time leaderboards
- Pub/sub messaging
- Configuration cache

### 3.3 NATS
**Version**: 2.10-alpine  
**Ports**: 4222 (client), 8222 (monitoring)

#### Features
- JetStream for persistence
- Event-driven architecture
- Cross-service communication
- Worker job distribution

### 3.4 Prometheus
**Version**: v2.48.0  
**Port**: 9091

#### Metrics Collection
- Application metrics
- System metrics
- Business metrics
- 200h retention

### 3.5 Grafana
**Version**: 10.2.0  
**Port**: 3001

#### Dashboards
- System health overview
- Provider performance
- User analytics
- Blockchain metrics
- Treasury monitoring

---

## 4. Blockchain Integration

### 4.1 Solana Program
**Program ID**: `2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7` (devnet)

#### On-Chain Accounts
- **Provider Registry**: Provider metadata and reputation
- **Treasury**: SOL storage for escrow
- **Pricing Oracle**: Current price feeds
- **Session Records**: Usage verification

### 4.2 Wallet Management
- **Treasury Wallet**: Receives user deposits
- **Oracle Keypair**: Signs price attestations
- **Provider Wallets**: Receive payouts

### 4.3 Price Feeds
**Sources** (failover order):
1. CoinGecko API
2. Binance API (no key required)
3. CoinMarketCap API

**Fallback**: Hardcoded 200 USD/SOL

---

## 5. Security Architecture

### 5.1 Authentication
- JWT tokens with refresh token rotation
- OAuth 2.0 (Google, GitHub)
- TOTP 2FA support
- Admin accounts with separate auth

### 5.2 Authorization
- Role-based access control (RBAC)
- API key authentication for providers
- IP allowlists
- Spending limits per trust tier

### 5.3 Data Protection
- Encryption at rest (AES-256)
- TLS 1.3 for all connections
- Row Level Security in PostgreSQL
- PII data masking

### 5.4 Network Security
- DDoS protection (adaptive rate limiting)
- Geo-blocking capabilities
- DNS rebinding protection
- Domain blocklist (gov, mil, etc.)
- WAF rules

---

## 6. Key Workflows

### 6.1 User Registration
```
1. User signs up via Web/App
2. KYC verification (if required)
3. Wallet connection (Solana)
4. Trust tier assignment
5. Spending limits applied
```

### 6.2 Proxy Session Creation
```
1. User requests proxy session
2. System matches with provider (ML routing)
3. Edge Gateway establishes tunnel
4. Usage tracking begins
5. Blockchain attestation (optional)
```

### 6.3 Provider Payout
```
1. Usage aggregation (hourly/daily)
2. ZK proof generation (optional)
3. Batch payout processing
4. Solana transaction execution
5. Treasury balance update
```

### 6.4 Pricing Update
```
1. Oracle fetches from price feeds
2. Price validation (outlier detection)
3. On-chain price update
4. Edge Gateway cache refresh
5. User notification (if significant change)
```

---

## 7. Performance Characteristics

### 7.1 Control API
- **Throughput**: 10,000+ req/sec
- **Latency**: <50ms p99
- **DB Connection Pool**: 100 connections

### 7.2 Edge Gateway
- **Proxy Throughput**: 100,000+ conn/sec
- **Latency**: <5ms (routing decision)
- **Session Cache**: 100,000 entries
- **Blockchain Events**: 10,000+ events/sec

### 7.3 Database
- **Read Replicas**: 3 replicas
- **Connection Pooling**: PgBouncer
- **Query Cache**: Redis-backed

---

## 8. Configuration Management

### 8.1 Environment Variables
**File**: `.env` (from `.env.example`)

#### Critical Secrets
```bash
JWT_SECRET              # JWT signing key
SESSION_SECRET          # Session encryption
ENCRYPTION_KEY          # Database encryption
DATABASE_URL            # PostgreSQL connection
REDIS_URL               # Redis connection
ORACLE_PRIVATE_KEY      # Solana oracle signer
```

#### Blockchain Config
```bash
SOLANA_RPC_ENDPOINT     # Solana RPC URL
SOLANA_NETWORK          # devnet/mainnet
SOLANA_PROGRAM_ID       # Program address
SOLANA_TREASURY_ADDRESS # Treasury wallet
```

#### API Keys
```bash
COINGECKO_API_KEY       # Price feed
COINMARKETCAP_API_KEY   # Price feed
PAYSTACK_SECRET_KEY     # Payments
SUPABASE_SERVICE_KEY    # Database
```

### 8.2 Dynamic Configuration
- Redis-stored configs
- Hot-reload without restart
- Feature flags
- A/B testing parameters

---

## 9. Monitoring & Observability

### 9.1 Metrics
**Prometheus endpoints**:
- Control API: `/metrics`
- Edge Gateway: `:8090/metrics`
- Redis: `:9121/metrics`

### 9.2 Logging
- Structured JSON logs
- Log levels: DEBUG, INFO, WARN, ERROR
- Centralized aggregation (configurable)

### 9.3 Tracing
- OpenTelemetry support
- Jaeger integration
- Distributed trace correlation

### 9.4 Alerting
- Health check endpoints
- Automatic failover
- Admin notifications

---

## 10. Deployment Architecture

### 10.1 Docker Compose (Development)
```yaml
# Primary compose file
docker-compose.yml          # Full stack

# Variants
docker-compose.dev.yml      # Development
docker-compose.prod.yml     # Production
docker-compose.minimal.yml  # Core services only
docker-compose.test.yml     # Testing
```

### 10.2 Kubernetes (Production)
**Location**: `infra/k8s/`

| File | Purpose |
|------|---------|
| `control-api-deployment.yaml` | Control API pods |
| `edge-gateway-deployment.yaml` | Edge Gateway pods |
| `postgresql-cluster.yaml` | HA PostgreSQL |
| `redis-cluster.yaml` | HA Redis |
| `hpa-autoscaling.yaml` | Horizontal Pod Autoscaler |
| `nginx-ingress.yaml` | Ingress controller |

### 10.3 Build Process

#### Control API
```dockerfile
# Multi-stage build
1. golang:1.24-alpine (builder)
2. apk add git ca-certificates
3. Copy vendor/ (pre-vendored)
4. go build -mod=vendor
5. alpine:3.20 (runtime)
```

#### Edge Gateway
```dockerfile
# Multi-stage build
1. rust:1.85-alpine (builder)
2. apk add musl-dev openssl-dev
3. Copy vendor/ (pre-vendored)
4. cargo build --release --offline
5. alpine:3.20 (runtime)
```

---

## 11. Known Issues & TODOs

### 11.1 Current Limitations
1. **ML Feature**: ONNX runtime optional (disabled by default)
2. **Blockchain**: Devnet only in current config
3. **KYC**: Manual verification workflow
4. **Provider CLI**: Basic functionality

### 11.2 Pending Optimizations
1. **P3 Actions**: Multi-region deployment
2. **Advanced Anti-Abuse**: Behavioral analysis
3. **Full gRPC**: Complete protobuf implementation
4. **Zk-Proofs**: Zero-knowledge usage verification

---

## 12. Development Guidelines

### 12.1 Code Organization
```
services/
├── control-api/          # Go backend
│   ├── internal/         # Private code
│   │   ├── api/          # HTTP handlers
│   │   ├── core/         # Business logic
│   │   ├── db/           # Database
│   │   └── solana/       # Blockchain
│   └── vendor/           # Vendored deps
│
└── edge-gateway/         # Rust proxy
    ├── src/              # Source code
    │   ├── blockchain/   # P2-A9 implementation
    │   ├── pricing/      # P2-A10 implementation
    │   └── security/     # P2-A7/P2-A8
    └── vendor/           # Vendored deps

apps/
├── web/                  # User frontend
└── admin/                # Admin panel
```

### 12.2 Testing Strategy
- **Unit Tests**: Each service
- **Integration Tests**: API contracts
- **E2E Tests**: Full workflows
- **Load Tests**: k6 scripts

### 12.3 Security Checklist
- [ ] No secrets in code
- [ ] Row Level Security enabled
- [ ] Input validation on all endpoints
- [ ] Rate limiting configured
- [ ] CORS properly set
- [ ] TLS certificates valid
- [ ] Dependencies updated

---

## 13. API Reference

### 13.1 Control API Endpoints

#### Authentication
```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/2fa/enable
```

#### Sessions
```
POST   /api/v1/sessions
GET    /api/v1/sessions/:id
DELETE /api/v1/sessions/:id
GET    /api/v1/sessions/:id/usage
```

#### Providers
```
POST   /api/v1/providers/register
GET    /api/v1/providers
GET    /api/v1/providers/:id
POST   /api/v1/providers/:id/nodes
```

#### Wallet
```
POST   /api/v1/wallet/connect
GET    /api/v1/wallet/balance
POST   /api/v1/wallet/deposit
POST   /api/v1/wallet/withdraw
```

### 13.2 Edge Gateway API

#### Health & Metrics
```
GET /health
GET /metrics
```

#### Proxy (SOCKS5/HTTP)
```
CONNECT :3128
```

---

## 14. Troubleshooting Guide

### 14.1 Common Issues

#### Database Connection Failures
```bash
# Check PostgreSQL status
docker-compose logs postgres

# Verify connection string
psql $DATABASE_URL -c "SELECT 1"
```

#### Redis Connection Issues
```bash
# Check Redis status
docker-compose logs redis
redis-cli ping
```

#### Solana Transaction Failures
```bash
# Check oracle keypair
cat oracle-keypair.json

# Verify treasury balance
solana balance $SOLANA_TREASURY_ADDRESS --url $SOLANA_RPC_ENDPOINT
```

#### Edge Gateway Build Failures
```bash
# Re-vendor dependencies
cd services/edge-gateway
cargo vendor

# Rebuild with no cache
docker-compose build --no-cache edge-gateway
```

### 14.2 Debug Commands

```bash
# View all service logs
docker-compose logs -f

# Check specific service
docker-compose logs -f control-api

# Exec into container
docker-compose exec control-api sh

# Database query
docker-compose exec postgres psql -U proxyhubb -d proxyhubb

# Redis CLI
docker-compose exec redis redis-cli
```

---

## 15. Resources & References

### Documentation
- **API Docs**: `services/control-api/docs/`
- **Docker Guide**: `DOCKER_SETUP_GUIDE.md`
- **Implementation Plan**: `IMPLEMENTATION_PLAN.md`
- **Architecture Report**: `DATABASE_ARCHITECTURE_REPORT.md`

### External Links
- Solana Documentation: https://docs.solana.com
- Gin Framework: https://gin-gonic.com
- Next.js: https://nextjs.org
- NATS: https://nats.io

### Support
- GitHub Issues: Project repository
- Internal Slack: #proxyhubb-dev

---

## Appendix A: Port Mapping

| Service | Internal Port | External Port | Protocol |
|---------|--------------|---------------|----------|
| Control API | 8080 | 8081 | HTTP |
| Edge Gateway (Proxy) | 3128 | 3128 | SOCKS5/HTTP |
| Edge Gateway (API) | 8090 | 8090 | HTTP |
| Web App | 3000 | 3000 | HTTP |
| Admin Panel | 3002 | 3002 | HTTP |
| PostgreSQL | 5432 | - | TCP |
| Redis | 6379 | - | TCP |
| NATS | 4222 | 4222 | TCP |
| NATS Monitor | 8222 | 8222 | HTTP |
| Prometheus | 9090 | 9091 | HTTP |
| Grafana | 3000 | 3001 | HTTP |
| Redis Exporter | 9121 | 9121 | HTTP |

---

## Appendix B: Environment Files

### Required Files
```
.env                          # Main environment (from .env.example)
.env.backup.*                 # Backup files
oracle-keypair.json           # Solana oracle keypair
treasury-keypair.json         # Solana treasury keypair (optional)
certs/                        # TLS certificates
├── server.crt
└── server.key
```

---

*End of System Analysis Report*
