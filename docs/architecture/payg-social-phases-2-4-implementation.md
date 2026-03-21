# Pay-As-You-Go Social System - Phases 2-4 Implementation

**Date:** March 19, 2026  
**Scope:** Complete PAYG Social System (Phases 2-4)  
**Status:** ✅ Implementation Complete

---

## Executive Summary

Implemented the complete Pay-As-You-Go social system for ProxyHubb, enabling:
- **Usage Milestones** - Gamification and rewards for bandwidth consumption
- **Usage-Based Reviews** - Reviews triggered by meaningful usage, not just purchase
- **Circle Bandwidth Pooling** - Enterprise-grade bandwidth pooling for providers

---

## Phase 2: Usage Milestones System ✅

### Overview
Automatically detects and celebrates when users reach bandwidth milestones (1GB, 10GB, 100GB, etc.), awarding badges and credits.

### Components

#### 1. Database Models
**File:** `services/control-api/internal/models/relationships.go`

```go
type UsageMilestone struct {
    UserID        uuid.UUID
    ProviderID    uuid.UUID
    MilestoneType string    // 'first_gb', 'ten_gb', 'hundred_gb', etc.
    ThresholdGB   float64
    RewardAmount  float64
    RewardClaimed bool
}
```

#### 2. Background Worker
**File:** `services/control-api/internal/worker/usage_milestones.go`

- Runs every 5 minutes
- Scans active sessions
- Triggers milestones at:
  - 1GB ("First Steps" badge)
  - 10GB ("Power User" badge + $5 credit)
  - 100GB ("Bandwidth Champion" badge + $25 credit)
  - 500GB ("Heavy Hitter" badge + $50 credit)
  - 1TB ("1TB Club" badge + $100 credit)

#### 3. API Endpoints
**File:** `services/control-api/internal/api/milestones.go`

| Endpoint | Description |
|----------|-------------|
| `GET /milestones` | Get user's achieved milestones |
| `GET /milestones/next` | Get next milestone with progress |
| `POST /milestones/:id/claim` | Claim milestone reward |

#### 4. Frontend Components
**Files:**
- `apps/web/src/components/MilestoneCelebration.tsx` - Celebration modal with confetti
- `apps/web/src/components/MilestoneProgress.tsx` - Dashboard widget showing progress

### Key Features

**Milestone Detection:**
```go
// Automatic detection every 5 minutes
func checkMilestones() {
    for _, session := range activeSessions {
        usedGB := float64(session.BytesUsed) / (1024 * 1024 * 1024)
        
        for _, milestone := range MilestoneDefinitions {
            if usedGB >= milestone.ThresholdGB {
                processMilestone(session, milestone)
            }
        }
    }
}
```

**Notifications:**
- WebSocket real-time notification to user
- Provider notification for significant milestones (50GB+)
- Feed event for major milestones (100GB+)

---

## Phase 3: Usage-Based Review System ✅

### Overview
Replaces purchase-based reviews with usage-based reviews. Users can only review after meaningful usage (1GB+ or 7+ days).

### Components

#### 1. Enhanced Review Model
**File:** `services/control-api/internal/models/review.go`

```go
type Review struct {
    // ... existing fields ...
    SessionID    *uuid.UUID     // Link to session for context
    UsageContext datatypes.JSON // Stores used_gb, duration_days
}
```

#### 2. Review Eligibility Engine
**File:** `services/control-api/internal/api/usage_reviews.go`

Eligibility criteria:
- ✅ Used 1GB+ (minimum meaningful usage)
- ✅ Session ended with usage
- ✅ Used for 7+ days (light but consistent usage)

**Review Prompt Triggers:**
- Milestone achievement (10GB+)
- Session ends
- Refill (returning customer)
- Support ticket resolution

#### 3. API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /sessions/:id/review-eligibility` | Check if session can be reviewed |
| `POST /sessions/:id/review` | Submit review with usage context |
| `GET /listings/:id/reviews-with-usage` | Get reviews with usage data |

#### 4. Frontend Components
**File:** `apps/web/src/components/UsageReviewModal.tsx`

Features:
- Shows usage context ("You've used 45GB over 15 days")
- Star ratings for Overall, Speed, Reliability, Support, Value
- Title and content fields
- "Would recommend" checkbox

### Usage Context Display

Reviews now show credibility through usage:
```
⭐⭐⭐⭐⭐ "Excellent for web scraping"
@Reviewer • Used 45GB over 15 days
```

Instead of:
```
⭐⭐⭐⭐⭐ "Good"
@Reviewer • Purchased 3 weeks ago
```

---

## Phase 4: Circle Bandwidth Pooling ✅

### Overview
Allows providers to form circles and pool bandwidth to serve enterprise customers with large requirements.

### Components

#### 1. New Models
**File:** `services/control-api/internal/models/circle_pool.go`

```go
// Enterprise quote for pooled bandwidth
type CircleQuote struct {
    CircleID       uuid.UUID
    BandwidthGB    float64    // e.g., 5000GB
    DurationMonths int        // e.g., 12 months
    FinalPrice     float64    // Calculated with discounts
    Status         string     // pending, accepted, rejected
}

// Session using pooled bandwidth
type CircleSession struct {
    CircleID   uuid.UUID
    BuyerID    uuid.UUID
    ProviderID uuid.UUID  // Assigned from pool
    TotalGB    float64
    UsedGB     float64
}

// Revenue distribution tracking
type CircleRevenue struct {
    CircleID   uuid.UUID
    ProviderID uuid.UUID
    Amount     float64
    Claimed    bool
}
```

#### 2. Enhanced Circle Member Model
**File:** `services/control-api/internal/models/circle.go`

```go
type CircleMember struct {
    // ... existing fields ...
    ContributedBandwidthGB float64    // How much they contribute to pool
    LastAssignedAt         *time.Time // For round-robin assignment
}
```

#### 3. API Endpoints
**File:** `services/control-api/internal/api/circle_pool.go`

| Endpoint | Description |
|----------|-------------|
| `GET /circles/:id/pool` | Get pool status and capacity |
| `POST /circles/:id/pool/contribute` | Add bandwidth to pool |
| `POST /circles/:id/quotes` | Request enterprise quote |
| `POST /circles/quotes/:id/accept` | Accept quote and create session |
| `GET /circles/:id/revenue` | View earned revenue |
| `POST /circles/:id/revenue/claim` | Claim earnings |

#### 4. Pool Management

**Contribution:**
```
Provider A contributes: 500GB
Provider B contributes: 300GB
Provider C contributes: 200GB
────────────────────────────────
Total Pool: 1000GB
```

**Enterprise Quote:**
```
Customer requests: 500GB/month for 6 months
Base price: $1,500 (500GB × $0.50 × 6)
Discount (500GB+): -$150 (10%)
Final price: $1,350
```

**Revenue Distribution:**
```
Provider A share: 50% → $675
Provider B share: 30% → $405
Provider C share: 20% → $270
```

#### 5. Round-Robin Provider Assignment

Sessions are distributed evenly across pool members:
```go
func selectProviderFromPool(circleID uuid.UUID) *uuid.UUID {
    // Get member who was assigned longest ago
    members := db.Social().Where("circle_id = ?", circleID).
        Order("last_assigned_at ASC NULLS FIRST").
        Find(&members)
    
    providerID := members[0].UserID
    members[0].LastAssignedAt = now
    db.Social().Save(&members[0])
    
    return &providerID
}
```

---

## Integration Points

### WebSocket Events

New message types added:

```go
const (
    // Milestones
    MsgTypeMilestone = "usage_milestone"
    
    // Reviews
    MsgTypeReviewPrompt = "review_prompt"
    
    // Circle Pool
    MsgTypePoolUpdated = "pool_updated"
    MsgTypeNewQuote = "new_quote_request"
    MsgTypeQuoteAccepted = "quote_accepted"
)
```

### Main.go Integration

```go
// Worker initialization
worker.InitUsageMilestoneWorker()

// Route registration
api.RegisterMilestoneRoutes(v1)
api.RegisterUsageReviewRoutes(v1)
api.RegisterCirclePoolRoutes(v1)
```

---

## File Changes Summary

### Backend

| File | Change |
|------|--------|
| `services/control-api/internal/worker/usage_milestones.go` | NEW - Milestone detection worker |
| `services/control-api/internal/api/milestones.go` | NEW - Milestone API endpoints |
| `services/control-api/internal/api/usage_reviews.go` | NEW - Usage-based review endpoints |
| `services/control-api/internal/api/circle_pool.go` | NEW - Circle pooling endpoints |
| `services/control-api/internal/models/relationships.go` | NEW - Milestone & relationship models |
| `services/control-api/internal/models/circle_pool.go` | NEW - Circle pool models |
| `services/control-api/internal/models/review.go` | MODIFIED - Added SessionID, UsageContext |
| `services/control-api/internal/models/circle.go` | MODIFIED - Added bandwidth contribution |
| `services/control-api/internal/models/notification.go` | MODIFIED - Added milestone types |
| `services/control-api/main.go` | MODIFIED - Worker & route registration |

### Frontend

| File | Change |
|------|--------|
| `apps/web/src/components/MilestoneCelebration.tsx` | NEW - Celebration modal |
| `apps/web/src/components/MilestoneProgress.tsx` | NEW - Progress widget |
| `apps/web/src/components/UsageReviewModal.tsx` | NEW - Review with context |

### Database

| Migration | Description |
|-----------|-------------|
| `20260319110000_add_conversation_to_sessions.sql` | Session-conversation linking |
| Implicit | Circle pool tables (circle_quotes, circle_sessions, circle_revenues) |

---

## Testing Checklist

### Phase 2: Milestones
- [ ] Worker detects 1GB milestone
- [ ] Celebration modal appears with confetti
- [ ] Badge is awarded
- [ ] Credit is added to account
- [ ] Provider is notified
- [ ] Progress bar updates in real-time

### Phase 3: Reviews
- [ ] Eligibility check returns correct status
- [ ] Review blocked before 1GB usage
- [ ] Review allowed after 1GB usage
- [ ] Usage context displayed in review
- [ ] Provider stats update after review

### Phase 4: Circle Pooling
- [ ] Provider can contribute bandwidth
- [ ] Enterprise quote can be requested
- [ ] Quote acceptance creates session
- [ ] Revenue distributed correctly
- [ ] Revenue can be claimed
- [ ] Round-robin assignment works

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Milestones achieved/day | 50+ |
| Review submission rate | 30% of eligible sessions |
| Circle pool utilization | 60%+ |
| Enterprise quote acceptance | 20%+ |
| Provider retention | +25% |

---

## Next Steps

1. **Deploy to staging** and run integration tests
2. **Monitor worker performance** - adjust check frequency if needed
3. **Gather user feedback** on milestone rewards
4. **Tune revenue sharing** formula based on actual usage
5. **Add more milestone tiers** if users reach 1TB quickly

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     PAYG SOCIAL SYSTEM                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   MILESTONES │  │    REVIEWS   │  │    CIRCLES   │      │
│  │              │  │              │  │              │      │
│  │ • 1GB Badge  │  │ • Usage      │  │ • Pooling    │      │
│  │ • 10GB $5    │  │   Context    │  │ • Enterprise │      │
│  │ • 100GB $25  │  │ • 1GB Min    │  │ • Revenue    │      │
│  │ • 1TB $100   │  │ • Quality    │  │   Share      │      │
│  │              │  │              │  │              │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │              │
│         └─────────────────┼─────────────────┘              │
│                           │                                │
│              ┌────────────┴────────────┐                  │
│              │    USAGE WORKER         │                  │
│              │  (Checks every 5 min)   │                  │
│              └────────────┬────────────┘                  │
│                           │                                │
│              ┌────────────┴────────────┐                  │
│              │    WEBSOCKET HUB        │                  │
│              │  (Real-time updates)    │                  │
│              └─────────────────────────┘                  │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

---

**Implementation Complete!** All three phases of the PAYG social system are now ready for testing and deployment. 🎉
