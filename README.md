# ProxyHubb

[![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8?style=flat&logo=go)](https://golang.org/)
[![Rust Version](https://img.shields.io/badge/Rust-1.75+-000000?style=flat&logo=rust)](https://www.rust-lang.org/)
[![Node Version](https://img.shields.io/badge/Node-20+-339933?style=flat&logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=flat&logo=docker)](https://www.docker.com/)

> **Decentralized Residential Proxy Marketplace** - Buy and sell proxy bandwidth with trustless blockchain escrow on Solana.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Services](#services)
- [Development](#development)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [API Documentation](#api-documentation)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

---

## 🎯 Overview

ProxyHubb is a decentralized marketplace that connects proxy buyers with residential proxy providers. The platform uses blockchain technology (Solana) to enable trustless transactions with escrow protection, ensuring both parties are protected.

### Key Features

- 🔒 **Trustless Escrow** - SOL and SPL token escrows with automatic settlement
- 🌍 **Global Proxy Network** - Residential proxies from providers worldwide
- ⚡ **High Performance** - Rust-based edge gateway for sub-millisecond latency
- 🛡️ **Enterprise Security** - WAF, DDoS protection, MFA, and audit logging
- 🗳️ **Decentralized Governance** - DAO-based protocol decisions
- 💬 **Social Features** - Provider reputation, reviews, and community forums
- 🤖 **AI Agent Orchestration** - Automated provider selection and optimization

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                       │
│                    Next.js 16 + React 19 Frontend                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EDGE GATEWAY (Rust)                                  │
│        HTTP Proxy (3128) │ Session Auth │ Load Balancing │ Circuit Breaker  │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CONTROL API (Go/Gin)                                   │
│   Auth │ Sessions │ Billing │ Marketplace │ Analytics │ Governance │ Workers │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DATA LAYER                                              │
│            PostgreSQL (Supabase) │ Redis │ NATS JetStream                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     BLOCKCHAIN (Solana)                                      │
│              Anchor Programs │ Escrow │ Treasury │ Oracle                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| API | Go 1.21+, Gin Framework, GORM |
| Proxy | Rust, Tokio, Hyper, Yamux |
| Database | PostgreSQL 15+ with Row Level Security |
| Cache | Redis 7+ (Cluster mode) |
| Message Bus | NATS 2.10+ with JetStream |
| Blockchain | Solana, Anchor Framework, Rust |
| Monitoring | Prometheus, Grafana |

---

## 🚀 Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24.0+
- [Docker Compose](https://docs.docker.com/compose/install/) 2.20+
- [Git](https://git-scm.com/downloads)
- [Go](https://golang.org/dl/) 1.21+ (for local development)
- [Rust](https://rustup.rs/) 1.75+ (for local development)
- [Node.js](https://nodejs.org/) 20+ (for local development)

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/proxyhubb.git
cd proxyhubb
```

### 2. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Generate security keys
./scripts/security-setup.ps1  # Windows
./scripts/security-setup.sh   # Linux/Mac

# Edit .env with your credentials
nano .env
```

**Required Environment Variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/proxyhubb` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | JWT signing key | (generate strong key) |
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | `eyJ...` |
| `SOLANA_PROGRAM_ID` | Deployed program ID | `2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7` |

### 3. Start with Docker Compose

```bash
# Start all services
docker-compose up -d

# Or use the full stack
docker-compose -f docker-compose.full.yml up -d

# View logs
docker-compose logs -f

# Check service health
curl http://localhost:8081/health
curl http://localhost:3000/api/health
```

### 4. Access the Application

| Service | URL | Description |
|---------|-----|-------------|
| Web App | http://localhost:3000 | Next.js frontend |
| API Docs | http://localhost:8081/v1/docs | Swagger/OpenAPI |
| Grafana | http://localhost:3001 | Metrics dashboard |
| Prometheus | http://localhost:9091 | Metrics collection |

---

## 🧩 Services

### Control API (`services/control-api/`)

Main business logic API written in Go.

```bash
cd services/control-api

# Install dependencies
go mod download

# Run migrations
go run main.go migrate

# Start server
go run main.go

# Run tests
go test ./...
```

**Key Features:**
- 80+ REST API endpoints
- Hexagonal architecture (Clean Architecture)
- 15+ background workers
- Solana blockchain integration
- Comprehensive middleware (auth, WAF, rate limiting)

### Edge Gateway (`services/edge-gateway/`)

High-performance proxy server written in Rust.

```bash
cd services/edge-gateway

# Build release binary
cargo build --release

# Run with default config
cargo run

# Run tests
cargo test
```

**Key Features:**
- HTTP CONNECT proxy protocol
- Session authentication via Redis
- Circuit breaker pattern
- Leader election for HA
- QoS traffic shaping

### Web Frontend (`apps/web/`)

Next.js 16 application with App Router.

```bash
cd apps/web

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Run e2e tests
npm run test:e2e
```

**Key Features:**
- Server-side rendering
- Solana wallet integration
- Real-time analytics
- Responsive design
- PWA support

### Solana Programs (`services/solana-programs/`)

Anchor framework smart contracts.

```bash
cd services/solana-programs/proxyhub

# Install dependencies
npm install

# Build programs
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Run tests
anchor test
```

**Programs:**
- `proxyhub` - Escrow, disputes, streaming payments
- `session` - Session tracking, gateway registry

---

## 💻 Development

### Project Structure

```
proxyhubb/
├── apps/
│   └── web/                    # Next.js frontend
├── services/
│   ├── control-api/           # Go API service
│   ├── edge-gateway/          # Rust proxy gateway
│   ├── solana-programs/       # Anchor smart contracts
│   └── relayer/               # Ethereum payout relayer
├── packages/
│   └── contracts/             # Solidity contracts
├── proto/                     # gRPC/protobuf definitions
├── infra/                     # Infrastructure configs
│   ├── k8s/                  # Kubernetes manifests
│   ├── grafana/              # Dashboard configs
│   └── prometheus/           # Monitoring configs
├── docs/                      # Documentation
├── migrations/                # Database migrations
└── scripts/                   # Utility scripts
```

### Development Workflow

1. **Create a branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes** following our coding standards

3. **Run tests:**
   ```bash
   # Go tests
   cd services/control-api && go test ./...
   
   # Rust tests
   cd services/edge-gateway && cargo test
   
   # TypeScript tests
   cd apps/web && npm test
   ```

4. **Lint your code:**
   ```bash
   # Go
   golangci-lint run
   
   # Rust
   cargo clippy
   
   # TypeScript
   eslint .
   ```

5. **Commit with conventional commits:**
   ```bash
   git commit -m "feat(api): add new endpoint for user analytics"
   ```

6. **Push and create PR:**
   ```bash
   git push origin feature/your-feature-name
   ```

### Database Migrations

```bash
# Create new migration
cd services/control-api
migrate create -ext sql -dir migrations -seq migration_name

# Run migrations
go run main.go migrate up

# Rollback migration
go run main.go migrate down
```

### Local Testing

```bash
# Run all tests
docker-compose -f docker-compose.test.yml up --abort-on-container-exit

# Run specific service tests
docker-compose run --rm control-api go test ./...
```

---

## 🚢 Deployment

### Docker Deployment

```bash
# Build all images
docker-compose build

# Production deployment
docker-compose -f docker-compose.prod.yml up -d
```

### Kubernetes Deployment

```bash
# Apply manifests
kubectl apply -f infra/k8s/

# Check status
kubectl get pods -n proxyhubb

# View logs
kubectl logs -f deployment/control-api -n proxyhubb
```

### Environment-Specific Configurations

| Environment | Compose File | Description |
|-------------|--------------|-------------|
| Development | `docker-compose.yml` | Local development |
| Testing | `docker-compose.test.yml` | CI/CD testing |
| Staging | `docker-compose.staging.yml` | Pre-production |
| Production | `docker-compose.prod.yml` | Production |
| Minimal | `docker-compose.minimal.yml` | Resource-constrained |

---

## ⚙️ Configuration

### Environment Variables Reference

See [ENVIRONMENT.md](docs/ENVIRONMENT.md) for complete environment variable documentation.

**Quick Reference:**

```bash
# Core Application
APP_ENV=development              # development, staging, production
PORT=8080                        # API server port
LOG_LEVEL=info                   # debug, info, warn, error

# Database
DATABASE_URL=postgresql://...    # PostgreSQL connection
DATABASE_MAX_CONNS=25            # Max connections
DATABASE_MAX_IDLE=10             # Max idle connections

# Redis
REDIS_URL=redis://localhost:6379 # Redis connection
REDIS_PASSWORD=                  # Redis password (if any)
REDIS_DB=0                       # Redis database number

# Authentication
JWT_SECRET=your-secret-key       # JWT signing key
SESSION_SECRET=session-secret    # Session encryption key
ACCESS_TOKEN_TTL=15m             # Access token lifetime
REFRESH_TOKEN_TTL=7d             # Refresh token lifetime

# Supabase
SUPABASE_URL=https://...         # Supabase project URL
SUPABASE_ANON_KEY=eyJ...         # Supabase anon key
SUPABASE_SERVICE_KEY=eyJ...      # Supabase service role key

# Solana
SOLANA_NETWORK=devnet            # devnet, mainnet-beta
SOLANA_RPC_ENDPOINT=https://...  # RPC endpoint
SOLANA_PROGRAM_ID=2yDRy...       # Deployed program ID
SOLANA_TREASURY_ADDRESS=...      # Treasury wallet address
ORACLE_PRIVATE_KEY=...           # Oracle signer key

# Payment Gateways
PAYSTACK_SECRET_KEY=sk_...       # Paystack secret
PAYSTACK_PUBLIC_KEY=pk_...       # Paystack public key

# SMTP (Email)
SMTP_HOST=smtp.gmail.com         # SMTP server
SMTP_PORT=587                    # SMTP port
SMTP_USER=...                    # SMTP username
SMTP_PASS=...                    # SMTP password

# OAuth
GOOGLE_CLIENT_ID=...             # Google OAuth client ID
GOOGLE_CLIENT_SECRET=...         # Google OAuth secret
GITHUB_CLIENT_ID=...             # GitHub OAuth client ID
GITHUB_CLIENT_SECRET=...         # GitHub OAuth secret

# Monitoring
PROMETHEUS_ENDPOINT=http://...   # Prometheus URL
JAEGER_ENDPOINT=http://...       # Jaeger tracing endpoint
SENTRY_DSN=...                   # Sentry error tracking
```

---

## 📚 API Documentation

### OpenAPI Specification

Full API documentation is available at:

- **Swagger UI:** http://localhost:8081/v1/docs (when running locally)
- **OpenAPI Spec:** [`docs/openapi.yaml`](docs/openapi.yaml)

### Authentication

All protected endpoints require a Bearer token:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     http://localhost:8081/v1/sessions
```

### Rate Limiting

| Tier | Requests/Minute | Bandwidth | Concurrency |
|------|----------------|-----------|-------------|
| New | 10 | 5 GB | 3 |
| Verified | 100 | 50 GB | 10 |
| Premium | 1000 | Unlimited | 100 |

Rate limit headers are included in responses:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Unix timestamp when limit resets

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

### Security Issues

Please do NOT report security issues publicly. Instead, email security@proxyhubb.com with details.

---

## 🔒 Security

### Security Features

- **Row Level Security (RLS)** - Database-level access control
- **Web Application Firewall (WAF)** - SQL injection, XSS protection
- **DDoS Protection** - Rate limiting and request throttling
- **Circuit Breakers** - Fault tolerance for external services
- **MFA/TOTP** - Two-factor authentication support
- **Audit Logging** - Comprehensive activity logging
- **Escrow Smart Contracts** - Trustless transaction security

### Security Best Practices

1. Never commit secrets to the repository
2. Use strong passwords and rotate them regularly
3. Enable 2FA on all accounts
4. Keep dependencies updated
5. Run security scans before deployment

### Reporting Vulnerabilities

See [SECURITY.md](SECURITY.md) for vulnerability reporting procedures.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Solana](https://solana.com/) - High-performance blockchain
- [Anchor Framework](https://anchor-lang.com/) - Solana development framework
- [Gin](https://gin-gonic.com/) - Go web framework
- [Tokio](https://tokio.rs/) - Rust async runtime
- [Next.js](https://nextjs.org/) - React framework
- [Supabase](https://supabase.com/) - Open source Firebase alternative

---

## 📞 Support

- **Documentation:** https://docs.proxyhubb.com
- **Discord:** https://discord.gg/proxyhubb
- **Twitter:** https://twitter.com/proxyhubb
- **Email:** support@proxyhubb.com

---

<p align="center">
  <strong>Built with ❤️ by the ProxyHubb Team</strong>
</p>
