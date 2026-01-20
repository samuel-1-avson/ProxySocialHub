# ProxySocialHub (v1.0) 🌐🚀

**The Decentralized Proxy & AI Agent Compute Network.**

A verified, consent-based marketplace for residential bandwidth and decentralized AI compute.

## 🏗️ Architecture

### Core Components
- **Control Plane (`services/control-api`)**: Go (Gin). Handles users, payments, escrow, and agent registry.
- **Data Plane (`services/edge-gateway`)**: Rust. High-performance proxy termination, traffic routing, and audit logging.
- **Blockchain (`services/solana-programs`)**: Solana (Anchor). Smart contracts for Escrow settlement and Agent Proof-of-Work.

### Applications
- **Web Dashboard (`apps/web`)**: Next.js 15. Marketplace for Buyers, Admin Console.
- **Provider Desktop (`apps/provider-desktop`)**: Tauri (Rust/React). Native client for bandwidth providers. "Connect & Earn".

### AI Agent Registry 🤖
- **Identity**: Agents register with `Ed25519` keys.
- **Verification**: Outputs are cryptographically signed and verified on-chain.
- **SDKs**:
  - `examples/rust-agent`: High-performance signing client.
  - `examples/agent_signing.py`: Python integration for LLMs.

## 🚀 Getting Started

### Prerequisites
- Docker & Docker Compose
- Go 1.22+
- Node.js 20+
- Rust 1.75+ (for Gateway & Tauri)

### Rapid Start (Local)
```bash
# 1. Start Support Services (DB, Redis, Validator)
docker-compose up -d

# 2. Run Control API
cd services/control-api
go run main.go

# 3. Run Frontend
cd apps/web
npm run dev
```

## 📦 Deployment
See `docker-compose.prod.yml` for production deployment configuration.

## 🔐 Security
- **Strict CORS**: Origin whitelist enforced.
- **Tunneling**: Secure Cloudflare Tunnel integration.
- **Audit**: rate-limiting, IP whitelisting, and strict session management.
