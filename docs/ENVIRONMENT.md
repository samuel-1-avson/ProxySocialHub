# Environment Variables Reference

This document provides a comprehensive reference for all environment variables used in the ProxyHubb system.

## Table of Contents

- [Quick Start](#quick-start)
- [Core Application](#core-application)
- [Database](#database)
- [Cache & Message Bus](#cache--message-bus)
- [Authentication](#authentication)
- [Supabase](#supabase)
- [Blockchain (Solana)](#blockchain-solana)
- [Payment Gateways](#payment-gateways)
- [Email (SMTP)](#email-smtp)
- [OAuth Providers](#oauth-providers)
- [Security](#security)
- [Monitoring & Observability](#monitoring--observability)
- [Feature Flags](#feature-flags)
- [Development Only](#development-only)

---

## Quick Start

Create your `.env` file:

```bash
cp .env.example .env
```

Generate secure secrets:

```bash
# Generate JWT secret (32+ bytes)
openssl rand -base64 32

# Generate session secret
openssl rand -base64 32

# Generate encryption key
openssl rand -base64 32
```

---

## Core Application

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `APP_ENV` | Yes | `development` | Environment: `development`, `staging`, `production` |
| `PORT` | No | `8080` | Port for Control API server |
| `LOG_LEVEL` | No | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `API_BASE_URL` | Yes | - | Public URL of the API (e.g., `https://api.proxyhubb.com`) |
| `FRONTEND_URL` | Yes | - | Public URL of the frontend (e.g., `https://app.proxyhubb.com`) |
| `CORS_ORIGINS` | Yes | - | Comma-separated list of allowed CORS origins |

### Example

```bash
APP_ENV=production
PORT=8080
LOG_LEVEL=info
API_BASE_URL=https://api.proxyhubb.com
FRONTEND_URL=https://app.proxyhubb.com
CORS_ORIGINS=https://app.proxyhubb.com,https://admin.proxyhubb.com
```

---

## Database

### PostgreSQL (Primary Database)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `DATABASE_MAX_CONNS` | No | `25` | Maximum number of open connections |
| `DATABASE_MAX_IDLE` | No | `10` | Maximum number of idle connections |
| `DATABASE_CONN_MAX_LIFETIME` | No | `30m` | Maximum lifetime of a connection |

### Connection String Format

```
postgresql://username:password@host:port/database?sslmode=require
```

### Example

```bash
# Supabase PostgreSQL
DATABASE_URL=postgresql://postgres:password@db.abc123.supabase.co:5432/postgres?sslmode=require

# Self-hosted PostgreSQL
DATABASE_URL=postgresql://proxyhubb:secure_password@localhost:5432/proxyhubb

# Connection pool settings
DATABASE_MAX_CONNS=25
DATABASE_MAX_IDLE=10
DATABASE_CONN_MAX_LIFETIME=30m
```

---

## Cache & Message Bus

### Redis

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | Yes | - | Redis connection string |
| `REDIS_PASSWORD` | No | - | Redis password (if required) |
| `REDIS_DB` | No | `0` | Redis database number (0-15) |
| `REDIS_CLUSTER` | No | `false` | Enable cluster mode |
| `REDIS_TLS_ENABLED` | No | `false` | Enable TLS for Redis |

### Example

```bash
# Single Redis instance
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your_redis_password
REDIS_DB=0

# Redis Cluster
REDIS_URL=redis://node1:6379,redis://node2:6379,redis://node3:6379
REDIS_CLUSTER=true

# TLS-enabled Redis
REDIS_URL=rediss://secure.redis.host:6380
REDIS_TLS_ENABLED=true
```

### NATS (Message Bus)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NATS_URL` | Yes | `nats://localhost:4222` | NATS server URL |
| `NATS_JETSTREAM_ENABLED` | No | `true` | Enable JetStream persistence |

### Example

```bash
NATS_URL=nats://localhost:4222
NATS_JETSTREAM_ENABLED=true
```

---

## Authentication

### JWT Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | - | Secret key for JWT signing (min 32 bytes) |
| `JWT_ISSUER` | No | `proxyhubb` | JWT issuer claim |
| `JWT_AUDIENCE` | No | `proxyhubb-api` | JWT audience claim |

### Session Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SESSION_SECRET` | Yes | - | Secret for session encryption |
| `SESSION_TTL` | No | `24h` | Session lifetime |
| `REFRESH_TOKEN_TTL` | No | `7d` | Refresh token lifetime |

### Example

```bash
# Generate with: openssl rand -base64 32
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_ISSUER=proxyhubb
JWT_AUDIENCE=proxyhubb-api

SESSION_SECRET=another-super-secret-key-for-sessions
SESSION_TTL=24h
REFRESH_TOKEN_TTL=7d
```

---

## Supabase

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUPABASE_URL` | Yes | - | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | - | Supabase anonymous/public key |
| `SUPABASE_SERVICE_KEY` | Yes | - | Supabase service role key (admin access) |

### Example

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

⚠️ **Security Warning:** Never expose `SUPABASE_SERVICE_KEY` in client-side code.

---

## Blockchain (Solana)

### Network Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOLANA_NETWORK` | No | `devnet` | Network: `devnet`, `mainnet-beta`, `testnet` |
| `SOLANA_RPC_ENDPOINT` | No | `https://api.devnet.solana.com` | Primary RPC endpoint |
| `SOLANA_RPC_ENDPOINTS` | No | - | Comma-separated fallback RPCs |
| `SOLANA_WS_ENDPOINT` | No | `wss://api.devnet.solana.com` | WebSocket endpoint |

### Program IDs

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOLANA_PROGRAM_ID` | Yes | - | ProxyHub program ID (deployed contract) |
| `SOLANA_SESSION_PROGRAM_ID` | No | - | Session program ID |

### Treasury & Oracle

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOLANA_TREASURY_ADDRESS` | Yes | - | Treasury wallet address (receives fees) |
| `NEXT_PUBLIC_SOLANA_TREASURY` | Yes | - | Public treasury address (for frontend) |
| `ORACLE_PRIVATE_KEY` | Yes | - | Oracle signer private key (base58) |
| `SOLANA_ORACLE_KEYPAIR` | No | `oracle-keypair.json` | Path to oracle keypair file |
| `PROVIDER_PRIVATE_KEY` | No | - | Provider node private key |

### Example

```bash
# Network settings
SOLANA_NETWORK=devnet
SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
SOLANA_RPC_ENDPOINTS=https://api.devnet.solana.com,https://solana-devnet.g.alchemy.com/v2/YOUR_KEY
SOLANA_WS_ENDPOINT=wss://api.devnet.solana.com

# Program IDs
SOLANA_PROGRAM_ID=2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7
SOLANA_SESSION_PROGRAM_ID=Se5sionXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Treasury and Oracle
SOLANA_TREASURY_ADDRESS=your-treasury-wallet-address
NEXT_PUBLIC_SOLANA_TREASURY=your-treasury-wallet-address
ORACLE_PRIVATE_KEY=base58-encoded-private-key
SOLANA_ORACLE_KEYPAIR=./oracle-keypair.json
```

⚠️ **Security Warning:** Keep `ORACLE_PRIVATE_KEY` and `PROVIDER_PRIVATE_KEY` secure. These control funds.

---

## Payment Gateways

### Paystack (Fiat Payments)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PAYSTACK_SECRET_KEY` | Yes | - | Paystack secret API key |
| `PAYSTACK_PUBLIC_KEY` | Yes | - | Paystack public API key |

### Example

```bash
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_PUBLIC_KEY=pk_test_...
```

### MoonPay (Crypto On-ramp)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MOONPAY_API_KEY` | No | - | MoonPay API key |
| `MOONPAY_SECRET_KEY` | No | - | MoonPay webhook secret |

---

## Email (SMTP)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SMTP_HOST` | Yes | - | SMTP server hostname |
| `SMTP_PORT` | No | `587` | SMTP port (587 for TLS, 465 for SSL) |
| `SMTP_USER` | Yes | - | SMTP username |
| `SMTP_PASS` | Yes | - | SMTP password |
| `SMTP_FROM` | No | `noreply@proxyhubb.com` | From email address |
| `SMTP_TLS` | No | `true` | Enable TLS |

### Example

```bash
# Gmail SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@proxyhubb.com
SMTP_TLS=true

# AWS SES
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=AKIA...
SMTP_PASS=...
```

---

## OAuth Providers

### Google OAuth

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | - | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | - | Google OAuth client secret |

### GitHub OAuth

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_CLIENT_ID` | Yes | - | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | Yes | - | GitHub OAuth app client secret |

### Example

```bash
# Google OAuth
GOOGLE_CLIENT_ID=123456789-abc123.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...

# GitHub OAuth
GITHUB_CLIENT_ID=Iv1.abc123...
GITHUB_CLIENT_SECRET=...
```

---

## Security

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENCRYPTION_KEY` | Yes | - | Key for encrypting sensitive data |
| `WAF_WHITELIST_IPS` | No | - | Comma-separated whitelisted IPs |
| `WAF_BLACKLIST_IPS` | No | - | Comma-separated blacklisted IPs |
| `RATE_LIMIT_ENABLED` | No | `true` | Enable rate limiting |
| `CIRCUIT_BREAKER_ENABLED` | No | `true` | Enable circuit breakers |

### Example

```bash
# Generate with: openssl rand -base64 32
ENCRYPTION_KEY=your-encryption-key-for-sensitive-data

# WAF Configuration
WAF_WHITELIST_IPS=10.0.0.0/8,172.16.0.0/12
WAF_BLACKLIST_IPS=192.168.1.100,10.0.0.50

# Security Features
RATE_LIMIT_ENABLED=true
CIRCUIT_BREAKER_ENABLED=true
```

---

## Monitoring & Observability

### Prometheus

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PROMETHEUS_ENDPOINT` | No | `http://localhost:9090` | Prometheus server URL |
| `METRICS_ENABLED` | No | `true` | Enable metrics collection |
| `METRICS_PORT` | No | `9090` | Port for metrics endpoint |

### Jaeger (Tracing)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JAEGER_ENDPOINT` | No | `http://localhost:14268/api/traces` | Jaeger collector URL |
| `JAEGER_AGENT_HOST` | No | `localhost` | Jaeger agent host |
| `JAEGER_AGENT_PORT` | No | `6831` | Jaeger agent port |
| `TRACING_ENABLED` | No | `true` | Enable distributed tracing |

### OpenTelemetry

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | `http://localhost:4317` | OTLP endpoint |
| `OTEL_SERVICE_NAME` | No | `proxyhubb-control-api` | Service name for tracing |

### Sentry (Error Tracking)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SENTRY_DSN` | No | - | Sentry project DSN |
| `SENTRY_ENVIRONMENT` | No | `development` | Sentry environment tag |

### Example

```bash
# Prometheus
METRICS_ENABLED=true
METRICS_PORT=9090
PROMETHEUS_ENDPOINT=http://prometheus:9090

# Jaeger Tracing
TRACING_ENABLED=true
JAEGER_ENDPOINT=http://jaeger:14268/api/traces

# OpenTelemetry
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
OTEL_SERVICE_NAME=proxyhubb-api

# Sentry
SENTRY_DSN=https://abc123@sentry.io/123456
SENTRY_ENVIRONMENT=production
```

---

## Edge Gateway

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EDGE_GATEWAY_MGMT_URL` | No | `http://edge-gateway:8090` | Edge gateway management URL |
| `EDGE_GATEWAY_PORT` | No | `3128` | Proxy port |
| `EDGE_GATEWAY_TUNNEL_PORT` | No | `8080` | Tunnel server port |
| `EDGE_GATEWAY_LEASE_TTL` | No | `30` | Leader election TTL (seconds) |
| `STICKY_TTL_SECS` | No | `3600` | Sticky session duration |

### Example

```bash
EDGE_GATEWAY_MGMT_URL=http://edge-gateway:8090
EDGE_GATEWAY_PORT=3128
EDGE_GATEWAY_TUNNEL_PORT=8080
EDGE_GATEWAY_LEASE_TTL=30
STICKY_TTL_SECS=3600
```

---

## Feature Flags

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FEATURE_KYC_REQUIRED` | No | `false` | Require KYC for all users |
| `FEATURE_BILLING_ENABLED` | No | `true` | Enable billing features |
| `FEATURE_GOVERNANCE_ENABLED` | No | `true` | Enable governance features |
| `FEATURE_AI_AGENTS_ENABLED` | No | `false` | Enable AI agent features |
| `FEATURE_SUBTENSOR_ENABLED` | No | `false` | Enable Bittensor integration |

### Example

```bash
FEATURE_KYC_REQUIRED=false
FEATURE_BILLING_ENABLED=true
FEATURE_GOVERNANCE_ENABLED=true
FEATURE_AI_AGENTS_ENABLED=false
FEATURE_SUBTENSOR_ENABLED=false
```

---

## Development Only

These variables should only be used in development:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEBUG` | No | `false` | Enable debug mode |
| `GIN_MODE` | No | `debug` | Gin framework mode: `debug`, `release`, `test` |
| `GO_ENV` | No | `development` | Go environment |
| `MOCK_PAYMENTS` | No | `false` | Mock payment processing |
| `MOCK_SOLANA` | No | `false` | Mock Solana blockchain |
| `SEED_DATA` | No | `false` | Seed database with test data |

### Example

```bash
DEBUG=true
GIN_MODE=debug
GO_ENV=development
MOCK_PAYMENTS=true
MOCK_SOLANA=true
SEED_DATA=true
```

⚠️ **Warning:** Never use development variables in production!

---

## Environment-Specific Examples

### Development

```bash
APP_ENV=development
LOG_LEVEL=debug
GIN_MODE=debug
DEBUG=true

# Local services
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/proxyhubb
REDIS_URL=redis://localhost:6379
NATS_URL=nats://localhost:4222

# Solana devnet
SOLANA_NETWORK=devnet
SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com

# Mock external services
MOCK_PAYMENTS=true
MOCK_SOLANA=false
```

### Staging

```bash
APP_ENV=staging
LOG_LEVEL=info
GIN_MODE=release

# Managed services
DATABASE_URL=postgresql://...railway.app
REDIS_URL=redis://...redis-cloud.com

# Solana devnet (for testing)
SOLANA_NETWORK=devnet

# Real external services
MOCK_PAYMENTS=false
MOCK_SOLANA=false
```

### Production

```bash
APP_ENV=production
LOG_LEVEL=warn
GIN_MODE=release

# High-availability services
DATABASE_URL=postgresql://...supabase.co
REDIS_URL=redis://...redis-cloud.com:6379
REDIS_CLUSTER=true
NATS_URL=nats://nats1:4222,nats://nats2:4222,nats://nats3:4222

# Solana mainnet
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_ENDPOINT=https://api.mainnet-beta.solana.com
SOLANA_RPC_ENDPOINTS=https://api.mainnet-beta.solana.com,https://solana-mainnet.g.alchemy.com/v2/KEY

# Security
RATE_LIMIT_ENABLED=true
CIRCUIT_BREAKER_ENABLED=true

# Monitoring
SENTRY_DSN=https://...sentry.io
TRACING_ENABLED=true
METRICS_ENABLED=true
```

---

## Validation

To validate your environment configuration:

```bash
# Run the environment check script
go run scripts/check-env.go

# Or use the make command
make check-env
```

---

## Security Checklist

Before deploying to production:

- [ ] All secrets are strong (32+ characters, random)
- [ ] No default passwords are used
- [ ] `APP_ENV` is set to `production`
- [ ] `DEBUG` is set to `false`
- [ ] `GIN_MODE` is set to `release`
- [ ] `MOCK_*` variables are set to `false`
- [ ] `SOLANA_NETWORK` is set to `mainnet-beta` (if using real funds)
- [ ] `RATE_LIMIT_ENABLED` is `true`
- [ ] Database uses SSL/TLS
- [ ] Redis password is set
- [ ] Sentry DSN is configured

---

## Troubleshooting

### Common Issues

**Issue:** `DATABASE_URL` connection refused
- Check if PostgreSQL is running
- Verify firewall rules
- Check SSL mode settings

**Issue:** Redis authentication failed
- Verify `REDIS_PASSWORD` is correct
- Check if Redis requires AUTH

**Issue:** Solana transactions failing
- Verify `SOLANA_RPC_ENDPOINT` is accessible
- Check `ORACLE_PRIVATE_KEY` has sufficient SOL for fees
- Ensure program ID is correctly deployed

**Issue:** JWT validation errors
- Verify `JWT_SECRET` matches between services
- Check system clock is synchronized (JWT is time-sensitive)

---

For more help, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md) or contact support.
