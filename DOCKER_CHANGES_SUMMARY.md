# Docker Changes Summary - PAYG Social System

**Date:** March 19, 2026  
**Scope:** Docker configuration updates for Phases 1-4

---

## Files Modified

### 1. docker-compose.yml
**Changes:** Added new environment variables to two services

#### control-api service (12 new env vars):
```yaml
# PAYG Social System (Phases 1-4)
# Milestone Worker Configuration
- MILESTONE_CHECK_INTERVAL_MINUTES=${MILESTONE_CHECK_INTERVAL_MINUTES:-5}
- MILESTONE_REWARDS_ENABLED=${MILESTONE_REWARDS_ENABLED:-true}
# Review System Configuration
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

#### web service (4 new build args):
```yaml
# PAYG Social System Feature Flags
- NEXT_PUBLIC_MILESTONES_ENABLED=${NEXT_PUBLIC_MILESTONES_ENABLED:-true}
- NEXT_PUBLIC_CIRCLE_POOLING_ENABLED=${NEXT_PUBLIC_CIRCLE_POOLING_ENABLED:-true}
- NEXT_PUBLIC_USAGE_REVIEWS_ENABLED=${NEXT_PUBLIC_USAGE_REVIEWS_ENABLED:-true}
- NEXT_PUBLIC_SOCIAL_PRESENCE_ENABLED=${NEXT_PUBLIC_SOCIAL_PRESENCE_ENABLED:-true}
```

### 2. .env.example
**Changes:** Added new section at end of file

```bash
# ============================================
# PAYG SOCIAL SYSTEM (Phases 1-4)
# ============================================
# (16 new environment variables with defaults)
```

### 3. migrations/20260319110000_add_conversation_to_sessions.sql
**Status:** Already created in previous steps
**Purpose:** Database schema updates for social features

---

## Files Created

### 1. DOCKER_SOCIAL_UPDATE.md
Complete deployment guide with:
- Migration steps
- Environment variable documentation
- Deployment procedures
- Verification commands
- Rollback plan

### 2. DOCKER_UPDATE_QUICKREF.md
Quick reference with:
- One-command update script
- Manual step-by-step
- Troubleshooting commands
- Monitoring queries

### 3. deploy-social-update.sh
Automated deployment script that:
- Creates database backup
- Checks/adds environment variables
- Rebuilds Docker images
- Runs migrations
- Performs health checks
- Verifies deployment

---

## Service Changes

### control-api Container
**New Components:**
- `UsageMilestoneWorker` - Background worker for milestone detection
- `milestone.go` - Milestone API handlers
- `usage_reviews.go` - Usage-based review handlers
- `circle_pool.go` - Circle bandwidth pooling handlers
- `listing_social.go` - Social integration for listings

**Auto-Start:**
- Worker starts automatically with main process
- GORM AutoMigrate creates new tables on first run

### web Container
**New Components:**
- `QuickMessageModal.tsx` - 1-click messaging from explorer
- `ListingCardEnhanced.tsx` - Enhanced proxy card with social elements
- `MilestoneCelebration.tsx` - Milestone celebration modal
- `MilestoneProgress.tsx` - Dashboard progress widget
- `UsageReviewModal.tsx` - Review with usage context

**Build Process:**
- Components automatically included in Next.js build
- Feature flags enable/disable UI elements

### db-migrate Container
**New Migration:**
- File: `migrations/20260319110000_add_conversation_to_sessions.sql`
- Creates 5 new tables
- Modifies 5 existing tables
- Adds indexes for performance

---

## Database Schema Changes

### New Tables (5)
1. `usage_milestones` - Tracks user bandwidth milestones
2. `provider_buyer_relationships` - Ongoing relationship tracking
3. `circle_quotes` - Enterprise quote requests
4. `circle_sessions` - Pooled bandwidth sessions
5. `circle_revenues` - Revenue distribution tracking

### Modified Tables (5)
1. `sessions` - Added `conversation_id`, `review_prompted`
2. `users` - Added `is_online`, `last_seen_at`
3. `proxy_listings` - Added `active_sessions_count`, `allow_direct_message`
4. `reviews` - Added `session_id`, `usage_context`
5. `circle_members` - Added `contributed_bandwidth_gb`, `last_assigned_at`

---

## Environment Variables

### Backend Configuration (10)
| Variable | Default | Description |
|----------|---------|-------------|
| `MILESTONE_CHECK_INTERVAL_MINUTES` | 5 | How often to check for milestones |
| `MILESTONE_REWARDS_ENABLED` | true | Enable milestone rewards |
| `REVIEW_MIN_USAGE_GB` | 1 | Min GB for review eligibility |
| `REVIEW_MIN_DURATION_DAYS` | 7 | Min days for review eligibility |
| `CIRCLE_POOL_ENABLED` | true | Enable circle pooling |
| `CIRCLE_MINIMUM_POOL_GB` | 100 | Min pool size |
| `CIRCLE_ENTERPRISE_THRESHOLD_GB` | 1000 | Enterprise threshold |
| `PRESENCE_HEARTBEAT_SECONDS` | 60 | Presence update frequency |
| `PRESENCE_TIMEOUT_MINUTES` | 5 | Offline timeout |

### Frontend Feature Flags (4)
| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_MILESTONES_ENABLED` | true | Show milestone UI |
| `NEXT_PUBLIC_CIRCLE_POOLING_ENABLED` | true | Show circle pooling UI |
| `NEXT_PUBLIC_USAGE_REVIEWS_ENABLED` | true | Show usage review UI |
| `NEXT_PUBLIC_SOCIAL_PRESENCE_ENABLED` | true | Show online indicators |

---

## Deployment Steps

### Option 1: Automated (Recommended)
```bash
chmod +x deploy-social-update.sh
./deploy-social-update.sh
```

### Option 2: Manual
```bash
# 1. Add env vars to .env
# 2. Rebuild
docker-compose build --no-cache control-api web
# 3. Migrate
docker-compose up db-migrate
# 4. Start
docker-compose up -d
```

### Option 3: Docker Compose Only
```bash
# Just update env vars and restart
docker-compose down
docker-compose up -d
```

---

## Health Verification

### API Health
```bash
curl http://localhost:8081/health
```

### Web Health
```bash
curl http://localhost:3000
```

### Database Tables
```bash
docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c "\dt"
```

### Milestone Worker
```bash
docker-compose logs control-api | grep "UsageMilestoneWorker"
```

---

## Rollback Procedure

If issues occur:

```bash
# 1. Stop
docker-compose down

# 2. Restore DB (if backup exists)
docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb < backup.sql

# 3. Revert code
git checkout <previous-commit>

# 4. Rebuild
docker-compose build --no-cache
docker-compose up -d
```

---

## Monitoring

### New Log Patterns
```bash
# Milestones
docker-compose logs -f control-api | grep -i milestone

# Reviews
docker-compose logs -f control-api | grep -i review

# Circle Pool
docker-compose logs -f control-api | grep -i "circle\|pool"

# Presence
docker-compose logs -f control-api | grep -i "online\|presence"
```

### Key Metrics
```sql
-- Milestones today
SELECT COUNT(*) FROM usage_milestones 
WHERE created_at > NOW() - INTERVAL '1 day';

-- Active pools
SELECT COUNT(*) FROM circles 
WHERE bandwidth_pool_gb > 0;

-- Usage-based reviews
SELECT COUNT(*) FROM reviews 
WHERE session_id IS NOT NULL;
```

---

## Port Mapping (Unchanged)

| Service | Host Port | Container Port |
|---------|-----------|----------------|
| control-api | 8081 | 8080 |
| web | 3000 | 3000 |
| edge-gateway | 3128, 8090 | 3128, 8090 |
| postgres | 5432 | 5432 |
| redis | 6379 | 6379 |
| nats | 4222, 8222 | 4222, 8222 |

---

## Summary

✅ **Docker Compose:** Updated with new environment variables  
✅ **Backend:** UsageMilestoneWorker auto-starts with API  
✅ **Frontend:** Feature flags control UI components  
✅ **Database:** Migration ready to run  
✅ **Scripts:** Automated deployment available  
✅ **Docs:** Complete deployment guide and quick reference  

**Ready for deployment!** 🚀
