# Docker Update for PAYG Social System

**Date:** March 19, 2026  
**Scope:** Phases 1-4 Complete Social System  
**Status:** Update Required

---

## Overview

This document describes the Docker updates required to deploy the new Pay-As-You-Go social system features:

1. **Phase 1:** Quick messaging from explorer
2. **Phase 2:** Usage milestones and gamification
3. **Phase 3:** Usage-based reviews
4. **Phase 4:** Circle bandwidth pooling

---

## Migration Files

### New Migration Added

**File:** `migrations/20260319110000_add_conversation_to_sessions.sql`

This migration adds:
- `conversation_id` to `sessions` table
- `provider_buyer_relationships` table
- `usage_milestones` table
- `active_sessions_count` to `proxy_listings`
- `is_online` / `last_seen_at` to `users`
- `circle_quotes`, `circle_sessions`, `circle_revenues` tables

### Migration Steps

```bash
# 1. Stop running containers
docker-compose down

# 2. Run database migrations
docker-compose up db-migrate

# 3. Start all services
docker-compose up -d
```

---

## Docker Compose Updates

### 1. Control API Service

Add the following environment variables to `docker-compose.yml` under `control-api`:

```yaml
# ==================== Control API ====================
control-api:
  # ... existing config ...
  environment:
    # ... existing env vars ...
    
    # --- PAYG Social System (NEW) ---
    # Milestone Worker Configuration
    - MILESTONE_CHECK_INTERVAL_MINUTES=${MILESTONE_CHECK_INTERVAL_MINUTES:-5}
    - MILESTONE_REWARDS_ENABLED=${MILESTONE_REWARDS_ENABLED:-true}
    
    # Review System
    - REVIEW_MIN_USAGE_GB=${REVIEW_MIN_USAGE_GB:-1}
    - REVIEW_MIN_DURATION_DAYS=${REVIEW_MIN_DURATION_DAYS:-7}
    
    # Circle Pool Configuration
    - CIRCLE_POOL_ENABLED=${CIRCLE_POOL_ENABLED:-true}
    - CIRCLE_MINIMUM_POOL_GB=${CIRCLE_MINIMUM_POOL_GB:-100}
    - CIRCLE_ENTERPRISE_THRESHOLD_GB=${CIRCLE_ENTERPRISE_THRESHOLD_GB:-1000}
    
    # Presence Tracking
    - PRESENCE_HEARTBEAT_SECONDS=${PRESENCE_HEARTBEAT_SECONDS:-60}
    - PRESENCE_TIMEOUT_MINUTES=${PRESENCE_TIMEOUT_MINUTES:-5}
```

### 2. Web Service

Add new build arguments to `docker-compose.yml` under `web`:

```yaml
# ==================== Web (Frontend) ====================
web:
  build:
    context: ./apps/web
    dockerfile: Dockerfile
    args:
      # ... existing args ...
      
      # PAYG Social Features (NEW)
      - NEXT_PUBLIC_MILESTONES_ENABLED=${NEXT_PUBLIC_MILESTONES_ENABLED:-true}
      - NEXT_PUBLIC_CIRCLE_POOLING_ENABLED=${NEXT_PUBLIC_CIRCLE_POOLING_ENABLED:-true}
      - NEXT_PUBLIC_USAGE_REVIEWS_ENABLED=${NEXT_PUBLIC_USAGE_REVIEWS_ENABLED:-true}
      - NEXT_PUBLIC_SOCIAL_PRESENCE_ENABLED=${NEXT_PUBLIC_SOCIAL_PRESENCE_ENABLED:-true}
```

---

## Environment Variables

### New Variables (Add to `.env`)

```bash
# ============================================
# PAYG SOCIAL SYSTEM (NEW)
# ============================================

# Milestone Worker
MILESTONE_CHECK_INTERVAL_MINUTES=5
MILESTONE_REWARDS_ENABLED=true

# Review System
REVIEW_MIN_USAGE_GB=1
REVIEW_MIN_DURATION_DAYS=7

# Circle Pool
CIRCLE_POOL_ENABLED=true
CIRCLE_MINIMUM_POOL_GB=100
CIRCLE_ENTERPRISE_THRESHOLD_GB=1000

# Presence Tracking
PRESENCE_HEARTBEAT_SECONDS=60
PRESENCE_TIMEOUT_MINUTES=5

# Frontend Feature Flags
NEXT_PUBLIC_MILESTONES_ENABLED=true
NEXT_PUBLIC_CIRCLE_POOLING_ENABLED=true
NEXT_PUBLIC_USAGE_REVIEWS_ENABLED=true
NEXT_PUBLIC_SOCIAL_PRESENCE_ENABLED=true
```

---

## Deployment Steps

### Step 1: Backup Database

```bash
# Create backup before migration
docker-compose exec postgres pg_dump -U proxyhubb proxyhubb > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Step 2: Update Environment

```bash
# Add new variables to .env
cat >> .env << 'EOF'

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
EOF
```

### Step 3: Rebuild Images

```bash
# Rebuild control-api with new code
docker-compose build --no-cache control-api

# Rebuild web with new components
docker-compose build --no-cache web
```

### Step 4: Run Migrations

```bash
# Run migrations only
docker-compose up db-migrate

# Check migration logs
docker-compose logs db-migrate
```

### Step 5: Start Services

```bash
# Start all services
docker-compose up -d

# Verify health
docker-compose ps
```

---

## Verification

### Check Migration Applied

```bash
# Connect to database
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "\dt"

# Check new tables exist
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT * FROM usage_milestones LIMIT 1;"
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT * FROM provider_buyer_relationships LIMIT 1;"
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "SELECT * FROM circle_quotes LIMIT 1;"
```

### Check Milestone Worker Running

```bash
# Check logs
docker-compose logs control-api | grep -i milestone

# Expected output:
# [UsageMilestoneWorker] Started
# [UsageMilestoneWorker] Checking milestones...
```

### Check API Endpoints

```bash
# Test milestone endpoint
curl http://localhost:8081/api/v1/milestones

# Test social context endpoint
curl http://localhost:8081/api/v1/listings/<id>/social

# Test circle pool endpoint
curl http://localhost:8081/api/v1/circles/<id>/pool
```

---

## Health Checks

### New Health Check Indicators

1. **Milestone Worker:** Check logs for "[UsageMilestoneWorker] Started"
2. **Database Tables:** Verify new tables exist
3. **API Endpoints:** Test new social endpoints
4. **WebSocket:** Verify real-time notifications work

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Migration fails | Check `docker-compose logs db-migrate` |
| Milestone worker not running | Check `docker-compose logs control-api` |
| Tables missing | Run `FORCE_MIGRATE=true docker-compose up db-migrate` |
| WebSocket errors | Verify `PRESENCE_HEARTBEAT_SECONDS` is set |

---

## Rollback Plan

If issues occur:

```bash
# 1. Stop services
docker-compose down

# 2. Restore database from backup
docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb < backup_YYYYMMDD_HHMMSS.sql

# 3. Revert to previous images
docker-compose pull

# 4. Start services
docker-compose up -d
```

---

## Monitoring

### New Metrics to Track

| Metric | Query |
|--------|-------|
| Milestones/day | `SELECT COUNT(*) FROM usage_milestones WHERE created_at > NOW() - INTERVAL '1 day'` |
| Active pools | `SELECT COUNT(*) FROM circles WHERE bandwidth_pool_gb > 0` |
| Pool utilization | `SELECT AVG(bandwidth_used_gb / bandwidth_pool_gb) FROM circles` |
| Reviews with usage | `SELECT COUNT(*) FROM reviews WHERE session_id IS NOT NULL` |

### Log Monitoring

```bash
# Watch milestone worker logs
docker-compose logs -f control-api | grep -i milestone

# Watch circle pool logs
docker-compose logs -f control-api | grep -i "circle\|pool"

# Watch review logs
docker-compose logs -f control-api | grep -i review
```

---

## Summary of Changes

### Backend Changes
- New worker: `UsageMilestoneWorker` (runs every 5 min)
- New APIs: Milestones, Usage Reviews, Circle Pool
- New models: UsageMilestone, ProviderBuyerRelationship, CircleQuote, CircleSession, CircleRevenue

### Frontend Changes
- New components: QuickMessageModal, ListingCardEnhanced, MilestoneCelebration, MilestoneProgress, UsageReviewModal

### Database Changes
- 3 new tables: `usage_milestones`, `provider_buyer_relationships`, `circle_quotes`, `circle_sessions`, `circle_revenues`
- 4 modified tables: `sessions`, `users`, `proxy_listings`, `reviews`, `circle_members`

---

**Ready for deployment!** 🚀
