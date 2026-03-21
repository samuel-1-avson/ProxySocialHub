# Docker Update Quick Reference

**Quick commands to update your Docker deployment with PAYG Social System**

---

## One-Command Update

### PowerShell (Windows)
```powershell
# Full deployment with all checks
.\deploy-social-update.ps1

# Simple deployment (faster)
.\deploy-social-update-simple.ps1
```

### Bash (Linux/Mac)
```bash
# Make script executable and run
chmod +x deploy-social-update.sh
./deploy-social-update.sh
```

---

## Manual Step-by-Step

### 1. Stop Services
```powershell
docker-compose down
```

### 2. Add Environment Variables

Add to your `.env` file:
```bash
# PAYG Social System
MILESTONE_CHECK_INTERVAL_MINUTES=5
MILESTONE_REWARDS_ENABLED=true
REVIEW_MIN_USAGE_GB=1
REVIEW_MIN_DURATION_DAYS=7
CIRCLE_POOL_ENABLED=true
CIRCLE_MINIMUM_POOL_GB=100
CIRCLE_ENTERPRISE_THRESHOLD_GB=1000
PRESENCE_HEARTBEAT_SECONDS=60
PRESENCE_TIMEOUT_MINUTES=5
NEXT_PUBLIC_MILESTONES_ENABLED=true
NEXT_PUBLIC_CIRCLE_POOLING_ENABLED=true
NEXT_PUBLIC_USAGE_REVIEWS_ENABLED=true
NEXT_PUBLIC_SOCIAL_PRESENCE_ENABLED=true
```

### 3. Rebuild Images
```powershell
docker-compose build --no-cache control-api web
```

### 4. Run Migrations
```powershell
docker-compose up db-migrate
```

### 5. Start Services
```powershell
docker-compose up -d
```

---

## Verification Commands

### Check Migration Applied (PowerShell)
```powershell
# Check new tables
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "\dt usage_milestones"
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "\dt provider_buyer_relationships"
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "\dt circle_quotes"
```

### Check Milestone Worker Running
```powershell
docker-compose logs control-api | Select-String -Pattern "milestone"
```

### Test API Endpoints
```powershell
# Milestone endpoint
Invoke-WebRequest http://localhost:8081/api/v1/milestones -UseBasicParsing

# Social context endpoint
Invoke-WebRequest http://localhost:8081/api/v1/listings/<listing-id>/social -UseBasicParsing
```

### Check Health
```powershell
# API health
Invoke-WebRequest http://localhost:8081/health -UseBasicParsing

# Web health
Invoke-WebRequest http://localhost:3000 -UseBasicParsing
```

---

## Troubleshooting

### Migration Failed
```powershell
# Check logs
docker-compose logs db-migrate

# Force re-run
$env:FORCE_MIGRATE = "true"
docker-compose up db-migrate
```

### Tables Missing
Tables are created by GORM AutoMigrate on first API start:
```powershell
# Restart control-api
docker-compose restart control-api

# Check logs
docker-compose logs control-api | Select-String -Pattern "AutoMigrate|table"
```

### Milestone Worker Not Running
```powershell
# Check if worker started
docker-compose logs control-api | Select-String -Pattern "UsageMilestoneWorker"

# Restart if needed
docker-compose restart control-api
```

### Frontend Not Showing New Features
```powershell
# Rebuild web with no cache
docker-compose build --no-cache web
docker-compose up -d web
```

---

## Rollback

If you need to rollback:

```powershell
# 1. Stop services
docker-compose down

# 2. Restore database (if you have backup)
docker-compose up -d postgres
docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb < backup.sql

# 3. Revert to previous git commit
git checkout <previous-commit>

# 4. Rebuild and start
docker-compose build --no-cache
docker-compose up -d
```

---

## Docker Compose Changes Summary

### control-api service:
- Added 12 new environment variables for social features
- Worker automatically starts with main process

### web service:
- Added 4 new build arguments for feature flags
- New components automatically included in build

### db-migrate service:
- Migration file: `migrations/20260319110000_add_conversation_to_sessions.sql`
- Runs automatically on deploy

---

## Monitoring New Features

### Watch Milestone Worker Logs (PowerShell)
```powershell
docker-compose logs -f control-api | Select-String -Pattern "milestone"
```

### Watch Circle Pool Activity
```powershell
docker-compose logs -f control-api | Select-String -Pattern "circle|pool"
```

### Watch Review System
```powershell
docker-compose logs -f control-api | Select-String -Pattern "review"
```

### Database Metrics (PowerShell)
```powershell
# Milestones today
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT COUNT(*) FROM usage_milestones WHERE created_at > NOW() - INTERVAL '1 day'"

# Active pools
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT COUNT(*) FROM circles WHERE bandwidth_pool_gb > 0"

# Reviews with usage context
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT COUNT(*) FROM reviews WHERE session_id IS NOT NULL"
```

---

**Done!** Your PAYG Social System is now running in Docker. 🚀
