# Docker Configuration Updates Summary

## Files Updated

### 1. `docker-compose.yml` (Main Production)
**Added environment variables:**
```yaml
# Price Feeds (Multi-Source)
- COINGECKO_API_KEY=${COINGECKO_API_KEY}
- COINGECKO_API_URL=${COINGECKO_API_URL:-https://api.coingecko.com/api/v3}
- COINMARKETCAP_API_KEY=${COINMARKETCAP_API_KEY}
```

### 2. `docker-compose.dev.yml` (Development)
**Added:**
- Price feed environment variables
- Oracle keypair volume mount
- SOLANA_TREASURY_ADDRESS

### 3. `docker-compose.prod.yml` (Production)
**Added:**
- Price feed environment variables
- SOLANA_TREASURY_ADDRESS

### 4. `docker-compose.test.yml` (New Test Environment)
**Created isolated test environment with:**
- Control API on port 8080
- PostgreSQL on port 5433 (isolated)
- Redis on port 6380 (isolated)
- Test runner service
- Pre-configured for DevNet testing

## New Files Created

### `scripts/test-docker.sh` (Linux/Mac)
Automated test environment setup:
- Port availability checks
- Oracle keypair generation (if missing)
- Docker image building
- Service health verification
- Endpoint testing

### `scripts/test-docker.ps1` (Windows PowerShell)
PowerShell version of test script with same functionality

### `DOCKER_SETUP_GUIDE.md`
Comprehensive documentation:
- Quick start instructions
- Environment variables reference
- Port mappings
- Testing procedures
- Troubleshooting guide

## Environment Variables Reference

### Required for New Features

| Variable | Default | Description |
|----------|---------|-------------|
| `COINGECKO_API_URL` | `https://api.coingecko.com/api/v3` | CoinGecko API endpoint |
| `COINGECKO_API_KEY` | (optional) | API key for higher rate limits |
| `COINMARKETCAP_API_KEY` | (optional) | Backup price source |
| `SOLANA_TREASURY_ADDRESS` | (required) | Treasury wallet address |
| `SOLANA_ORACLE_KEYPAIR` | `/run/secrets/oracle-keypair.json` | Path to oracle keypair |

### File Mounts

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `./oracle-keypair.json` | `/run/secrets/oracle-keypair.json` | Oracle signing key |

## Port Assignments

### Test Environment (`docker-compose.test.yml`)
| Service | Host Port | Container Port |
|---------|-----------|----------------|
| Control API | 8080 | 8080 |
| PostgreSQL | 5433 | 5432 |
| Redis | 6380 | 6379 |

### Development Environment (`docker-compose.dev.yml`)
| Service | Host Port | Container Port |
|---------|-----------|----------------|
| Control API | 8080 | 8080 |
| PostgreSQL | 5432 | 5432 |
| Redis | 6379 | 6379 |
| Prometheus | 9090 | 9090 |
| Grafana | 3001 | 3000 |

## Testing Commands

### Start Test Environment
```bash
# Linux/Mac
./scripts/test-docker.sh

# Windows
.\scripts\test-docker.ps1
```

### Verify Features
```bash
# Health check
curl http://localhost:8080/health

# Price feed
curl http://localhost:8080/v1/pricing/sol

# Price sources
curl http://localhost:8080/v1/admin/pricing/sources
```

### Stop Test Environment
```bash
docker-compose -f docker-compose.test.yml down -v
```

## Migration Support

All database migrations are automatically applied on container startup:

1. **000027_sol_only_currency** - Removes GHS/USDT, SOL-only system
2. **000028_spending_limits** - Adds spending limit columns and tables
3. **000029_batch_payouts** - Adds batch payout tables

## Docker Images

### Control API
- **Build context:** `./services/control-api`
- **Dockerfile:** `Dockerfile` (production) or `Dockerfile.simple` (dev)
- **Base image:** `golang:1.24-alpine` → `alpine:3.20`

### Health Checks
All services include health checks:
- Control API: HTTP GET /health
- PostgreSQL: pg_isready
- Redis: redis-cli ping

## Next Steps for Testing

1. **Run the test script:**
   ```bash
   ./scripts/test-docker.sh
   ```

2. **Verify all services start:**
   ```bash
   docker-compose -f docker-compose.test.yml ps
   ```

3. **Test the endpoints:**
   ```bash
   curl http://localhost:8080/health
   curl http://localhost:8080/v1/pricing/sol
   ```

4. **Check logs if issues:**
   ```bash
   docker-compose -f docker-compose.test.yml logs -f control-api
   ```

## Notes

- Test environment uses isolated ports (5433, 6380) to avoid conflicts
- DevNet is default for testing (mainnet for production)
- Oracle keypair is auto-generated for testing (replace for real use)
- All migrations run automatically on startup
