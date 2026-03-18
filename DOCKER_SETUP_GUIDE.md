# Docker Setup Guide - Financial Engine Updates

This guide covers the Docker configuration updates for the new financial engine features:
- Multi-source price feeds
- User spending limits
- Batch payout processing

## Quick Start

### Prerequisites
- Docker 20.10+ and Docker Compose
- (Optional) CoinGecko API key for production
- (Optional) CoinMarketCap API key for redundancy

### Test Environment

For testing the new features:

```bash
# Linux/Mac
./scripts/test-docker.sh

# Windows PowerShell
.\scripts\test-docker.ps1
```

This will:
1. Check for required ports
2. Create test oracle keypair if needed
3. Build Docker images
4. Start PostgreSQL (port 5433), Redis (port 6380), and Control API (port 8080)
5. Run database migrations
6. Verify health endpoints

### Test Endpoints

Once running, verify the features:

```bash
# Health check
curl http://localhost:8080/health

# Get SOL price (tests multi-source price feed)
curl http://localhost:8080/v1/pricing/sol

# Check price sources health
curl http://localhost:8080/v1/admin/pricing/sources

# Check price feed health
curl http://localhost:8080/v1/admin/pricing/health
```

## Environment Variables

### New Variables (Required)

```bash
# Price Feeds
COINGECKO_API_URL=https://api.coingecko.com/api/v3
COINGECKO_API_KEY=your-api-key-here  # Optional: higher rate limits
COINMARKETCAP_API_KEY=your-api-key-here  # Optional: fallback source

# Solana
SOLANA_TREASURY_ADDRESS=your-treasury-address
SOLANA_ORACLE_KEYPAIR=/run/secrets/oracle-keypair.json
```

### Oracle Keypair

The oracle keypair is mounted as a Docker secret:

```bash
# Generate keypair (if you don't have one)
solana-keygen new -o oracle-keypair.json --no-passphrase

# For testing, a dummy keypair is created automatically
```

## Docker Compose Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Main production file |
| `docker-compose.dev.yml` | Development with hot reload |
| `docker-compose.test.yml` | Isolated testing environment |
| `docker-compose.prod.yml` | Production deployment |

## Testing New Features

### 1. Multi-Source Price Feeds

```bash
# Start test environment
docker-compose -f docker-compose.test.yml up -d

# Wait 30 seconds for price feed to initialize
sleep 30

# Check price
curl http://localhost:8080/v1/pricing/sol

# Check source health
curl http://localhost:8080/v1/admin/pricing/health
```

### 2. Batch Payout Processing

```bash
# View payout queue (admin endpoint)
curl http://localhost:8080/v1/admin/payouts/queue

# Force process batches
curl -X POST http://localhost:8080/v1/admin/payouts/process

# View batch stats
curl http://localhost:8080/v1/admin/payouts/stats
```

### 3. Spending Limits

```bash
# Get current limits (requires authentication)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/v1/wallet/limits

# Update limits (requires authentication)
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"daily": 5.0}' \
  http://localhost:8080/v1/wallet/limits
```

## Port Mappings

### Test Environment
| Service | Host Port | Container Port |
|---------|-----------|----------------|
| Control API | 8080 | 8080 |
| PostgreSQL | 5433 | 5432 |
| Redis | 6380 | 6379 |

### Development Environment
| Service | Host Port | Container Port |
|---------|-----------|----------------|
| Control API | 8080 | 8080 |
| PostgreSQL | 5432 | 5432 |
| Redis | 6379 | 6379 |
| Prometheus | 9090 | 9090 |
| Grafana | 3001 | 3000 |

## Troubleshooting

### Port Conflicts

If you see "Port already in use" errors:

```bash
# Find what's using the port (Linux/Mac)
lsof -i :8080

# Find what's using the port (Windows)
Get-NetTCPConnection -LocalPort 8080

# Stop existing containers
docker-compose -f docker-compose.test.yml down -v
```

### Database Connection Issues

```bash
# Reset test database
docker-compose -f docker-compose.test.yml down -v
docker-compose -f docker-compose.test.yml up -d postgres

# Check database logs
docker-compose -f docker-compose.test.yml logs postgres
```

### API Not Starting

```bash
# Check API logs
docker-compose -f docker-compose.test.yml logs control-api

# Verify environment variables
docker-compose -f docker-compose.test.yml config
```

## Production Deployment

### 1. Set Environment Variables

```bash
# .env file
COINGECKO_API_KEY=your-production-key
COINMARKETCAP_API_KEY=your-fallback-key
SOLANA_TREASURY_ADDRESS=your-mainnet-treasury
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_ENDPOINT=https://api.mainnet-beta.solana.com
```

### 2. Deploy

```bash
# Production
docker-compose -f docker-compose.prod.yml up -d

# Or with swarm
docker stack deploy -c docker-compose.prod.yml proxyhubb
```

### 3. Verify

```bash
# Health check
curl https://api.yourdomain.com/health

# Price feed
curl https://api.yourdomain.com/v1/pricing/sol
```

## Migration Status

All migrations are automatically applied on container startup:

| Migration | Description | Status |
|-----------|-------------|--------|
| 000027 | SOL-only currency | ✅ Included |
| 000028 | Spending limits | ✅ Included |
| 000029 | Batch payouts | ✅ Included |

## Monitoring

### Grafana Dashboards

Access Grafana at http://localhost:3001 (admin/admin)

Available dashboards:
- System metrics
- Price feed health
- Payout statistics

### Logs

```bash
# All services
docker-compose -f docker-compose.test.yml logs -f

# Specific service
docker-compose -f docker-compose.test.yml logs -f control-api
```

## Cleanup

```bash
# Stop and remove containers
docker-compose -f docker-compose.test.yml down

# Stop and remove containers + volumes (data loss!)
docker-compose -f docker-compose.test.yml down -v

# Remove all images
docker-compose -f docker-compose.test.yml down --rmi all
```

## Support

For issues with the Docker setup:
1. Check logs: `docker-compose logs`
2. Verify environment variables
3. Check port availability
4. Review migration status in database
