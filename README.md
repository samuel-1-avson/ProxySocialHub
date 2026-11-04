# ProxyHubb

**A decentralized residential proxy marketplace, settled on Solana.**

Buyers discover proxy listings, fund an on-chain escrow, and route traffic through a global edge network. Providers run a lightweight daemon that advertises spare bandwidth and earns from real usage — settled per session, on-chain.

[![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF?logo=solana&logoColor=white)](https://solana.com)
[![Go](https://img.shields.io/badge/Control%20Plane-Go-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![Rust](https://img.shields.io/badge/Edge%20%26%20Provider-Rust-000000?logo=rust&logoColor=white)](https://rust-lang.org)
[![Next.js](https://img.shields.io/badge/Web-Next.js-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![License](https://img.shields.io/badge/SDK%20License-MIT-green.svg)](#license)

---

## Overview

| Surface | Location |
|---------|----------|
| Marketplace | [proxyhubb.com](https://proxyhubb.com) |
| Documentation | [docs.proxyhubb.com](https://docs.proxyhubb.com) |
| API | [api.proxyhubb.com](https://api.proxyhubb.com) |
| Buyer proxy endpoint | `proxy.proxyhubb.com:8090` (HTTP CONNECT / SOCKS5) |
| Browser extension | Chrome Web Store (unlisted) |

---

## How it works

```
 Buyers                        Platform                         Providers
┌──────────────────┐                                   ┌──────────────────┐
│  Web · SDK ·     │   JWT / API key    ┌────────────┐ │  provider-node   │
│  Chrome extension│ ─────────────────► │ control-api│ │  (Rust daemon)   │
└────────┬─────────┘                    │     (Go)   │ └────────┬─────────┘
         │                              └─────┬──────┘          │
         │  HTTP CONNECT / SOCKS5             │                 │ Yamux / QUIC
         │  + HMAC credentials                ▼                 ▼
         │              ┌────────────────────────────────────────────┐
         └────────────► │              edge-gateway (Rust)           │
                        └────────────────────────────────────────────┘
                                          │
                        ┌─────────────────▼──────────────────┐
                        │   Solana escrow program (Anchor)   │
                        │   initialize → settle / refund →   │
                        │   close (rent returned to buyer)   │
                        └────────────────────────────────────┘
```

1. **Discover** — browse listings by region, protocol, price, and live health on the marketplace map.
2. **Pay** — fund an escrow PDA from your Solana wallet; funds stay locked on-chain until settlement.
3. **Connect** — receive HMAC credentials and route traffic via CONNECT/SOCKS5, the SDKs, or the Chrome extension.
4. **Settle** — when the session ends, usage is metered, the provider is paid, the buyer is refunded the unused remainder, and the escrow account is closed.

---

## Features

**Marketplace**
- Listing discovery with an interactive network map and region-level geolocation
- Catalog products and offers, saved listings, reviews, and seller profiles
- Pay-as-you-go orders backed by Solana escrow — no custodial balance required

**Buyer experience**
- Hubbie, your personal account assistant powered by the Meta Model API: help guides, live listing discovery, account checks, and guided next steps ([setup](docs/ops/PLATFORM_ASSISTANT.md))
- Chrome extension: pair with a purchased order and toggle the proxy per browser profile
- Official SDKs for Node.js, Python, and Go
- Bulk proxy pools and machine API keys for B2B integrations
- Subscription plans with listing and bandwidth entitlements

**Provider experience**
- One-command node onboarding via the provider CLI
- Heartbeats, capacity advertising, and per-session earnings
- On-chain provider registry with quality attestations

**Platform**
- Wallet-based authentication (no passwords) plus scoped API keys
- Metric honesty: every health figure carries a provenance label — live-measured values are shown as measured; everything else is presented as unmeasured rather than implied
- Pre-purchase privacy: a provider's exact network identity is revealed only after escrow, through the signed session handshake

---

## Payments & escrow

Escrow is handled by an Anchor program on Solana (currently devnet).

- Each purchase locks funds in a program-derived escrow account unique to the transaction.
- Settlement pays the provider for metered usage and refunds the buyer the remainder.
- Terminal escrows are closed on-chain, returning the rent reserve to the buyer.
- Expired or unfunded orders are reconciled automatically by the control plane.
- The web app validates cluster and balance before any wallet prompt, so a wrong-network wallet fails with a clear message instead of a stuck transaction.

---

## Repository layout

| Path | Description |
|------|-------------|
| `apps/web` | Marketplace and dashboard UI (Next.js) |
| `apps/extension` | Chrome extension (MV3) |
| `apps/docs` | Public documentation site |
| `services/control-api` | REST control plane (Go) |
| `services/edge-gateway` | Buyer admission and provider tunnels (Rust) |
| `services/provider-node` | Provider daemon (Rust) |
| `services/solana-programs` | Escrow and registry programs (Anchor) |
| `cli/` | Provider CLI |
| `sdks/` | Node.js, Python, and Go buyer SDKs |
| `migrations/` | PostgreSQL schema migrations |
| `infra/` | Observability stack |
| `scripts/` | Local verification and deployment helpers |

---

## Getting started

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for the web app and extension)
- A Solana wallet (Phantom recommended) for marketplace interactions

### Run the stack

```bash
cp .env.example .env
# Fill in the required secrets, then:
docker compose up -d --build
```

| Service | Local address |
|---------|---------------|
| API | http://localhost:18080 |
| Web | http://localhost:3009 |
| Buyer CONNECT | localhost:8090 |
| Provider tunnel | localhost:3128 |

Database migrations run automatically on startup.

### Browser extension

```bash
cd apps/extension
npm install
npm run build
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension/dist`.

---

## SDKs

```bash
npm install @proxyhubb/sdk        # Node.js
pip install proxyhubb             # Python
go get github.com/samuel-1-avson/ProxySocialHub/sdks/go
```

All SDKs share the same surface: create connect intents, retrieve marketplace credentials, and manage bulk pools. Default API base is `https://api.proxyhubb.com`.

---

## API

The control plane exposes a versioned REST API under `/v1`. The OpenAPI specification is served at `https://api.proxyhubb.com/openapi.json`.

| Area | Endpoints |
|------|-----------|
| Auth & sessions | `/v1/auth/*`, `/v1/sessions/*` |
| Marketplace | `/v1/listings`, `/v1/catalog/*`, `/v1/orders/*` |
| Bulk pools | `/v1/bulk/pools`, `/v1/bulk/api-keys` |
| Subscriptions | `/v1/subscriptions/*` |
| Provider | `/v1/provider/*` |

Authentication is either a wallet-session bearer token or an `X-API-Key: phub_…` key with explicit scopes.

---

## Security

- No custodial funds: buyer payments live in on-chain escrow until settlement.
- Exception: accounts created with **Sign in with Google** get a ProxyHubb-managed Solana wallet. Its key is held by the platform (envelope-encrypted; see `services/control-api/internal/custody`), so those wallets are custodial. Wallet sign-in users stay non-custodial.
- Google-account buyers can pay in GHS through Paystack (`FIAT_PAYMENTS_ENABLED`). The treasury sends the SOL to their managed wallet and the server signs the normal on-chain escrow, so providers are paid exactly as before. See `services/control-api/internal/api/orders_paystack.go`.
- Prometheus metrics endpoints are authenticated and unreachable from the public host.
- Internal message-bus ports bind to localhost in production.
- Secrets are never committed — the repository is guarded by automated secret scanning on every commit and push.
- The buyer proxy supports CONNECT and SOCKS5 only; it is not an open forward proxy.

---

## Deployment

The production testnet runs on Google Compute Engine as a Compose stack behind Caddy (automatic TLS). Web releases are deployed as pinned, tagged container images pulled from GHCR — the live frontend is always reproducible from a tag, never an ad-hoc build.

---

## Contributing

- Use a wallet session or scoped API key for machine access.
- Solana program builds and tests run in Docker for cross-platform parity.
- Keep the metric-honesty contract: never present unmeasured defaults as live measurements.

---

## License

See the repository license file. SDKs under `sdks/` are MIT unless noted otherwise in package metadata.
