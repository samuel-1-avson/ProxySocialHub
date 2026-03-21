# ProxyHubb Social System: Pay-As-You-Go Integration

**Date:** March 19, 2026  
**Model:** Pay-As-Go (Consumption-based, not subscription)  
**Impact:** Social features must support ongoing relationships, not one-time transactions

---

## 1. Pay-As-You-Go Changes Everything

### 1.1 Traditional vs Pay-As-You-Go Social Patterns

| Aspect | Traditional (Fixed) | Pay-As-You-Go (ProxyHubb) |
|--------|--------------------|---------------------------|
| **Order lifecycle** | One-time purchase → Done | Continuous usage → Refill → Extend |
| **Provider relationship** | Transactional | Ongoing partnership |
| **Review timing** | After delivery | After usage milestone |
| **Trust signals** | Single purchase rating | Consistent quality over time |
| **Communication** | Pre-sale only | Pre-sale + Usage support + Refill |
| **Social proof** | "100 sold" | "2.3TB served this month" |

### 1.2 Key Implications for Social Design

```
Traditional Flow:          Pay-As-You-Go Flow:
                           
Browse → Buy → Review     Browse → Buy → USE → Refill → Extend → Review
              ↑                  ↓       ↓       ↓
              └────────  [Ongoing chat, support, usage alerts]
```

**The Big Difference:** Social features must support **ongoing relationships**, not just one-time transactions.

---

## 2. Revised Integration Strategy for Pay-As-You-Go

### 2.1 Order Lifecycle Social Touchpoints

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PAY-AS-YOU-GO ORDER JOURNEY                          │
│                     (With Social Integration)                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   │
│  │ DISCOVER│──→│  BUY    │──→│  USE    │──→│ REFILL  │──→│ EXTEND  │   │
│  │         │   │         │   │         │   │         │   │         │   │
│  │• Message│   │• Welcome│   │• Usage  │   │• Low    │   │• Review │   │
│  │  provider│   │  message│   │  alerts │   │  balance│   │  prompt │   │
│  │• Q&A    │   │• Setup  │   │• Support│   │• Offer  │   │• Badge  │   │
│  │         │   │  help   │   │  chat   │   │  from    │   │  unlock │   │
│  │         │   │         │   │         │   │  provider│   │         │   │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘   │
│       │            │            │            │            │            │
│       └────────────┴────────────┴────────────┴────────────┘            │
│                         │                                              │
│              ┌──────────┴──────────┐                                   │
│              │  ONGOING CHAT THREAD  │                                   │
│              │  (Same conversation   │                                   │
│              │   throughout lifecycle) │                                   │
│              └─────────────────────┘                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Usage-Based Social Features

#### Feature 1: Usage Milestone Celebrations

When buyer hits usage milestones, celebrate and prompt engagement:

```
┌─────────────────────────────────────────┐
│ 🎉 Milestone Reached!                   │
├─────────────────────────────────────────┤
│                                         │
│ You've used 100GB with @Provider!      │
│                                         │
│ Your experience:                        │
│ ⭐ ⭐ ⭐ ⭐ ⭐                          │
│                                         │
│ [Quick Review] [Refill +10GB] [Share]  │
│                                         │
└─────────────────────────────────────────┘
```

**Implementation:**
```go
// services/control-api/internal/worker/usage_milestones.go

type UsageMilestone struct {
    ThresholdGB float64
    Badge       string
    Reward      float64 // Credit amount
}

var milestones = []UsageMilestone{
    {10, "First Steps", 0},
    {100, "Power User", 5.0},    // $5 credit
    {500, "Bandwidth Champion", 25.0},
    {1000, "1TB Club", 50.0},
}

func checkUsageMilestones(sessionID uuid.UUID) {
    session := getSession(sessionID)
    usedGB := session.BandwidthUsed
    
    for _, m := range milestones {
        if usedGB >= m.ThresholdGB && !hasReachedMilestone(session.UserID, m) {
            // Award milestone
            awardMilestone(session.UserID, m)
            
            // Create feed event
            CreateFeedEvent(&session.UserID, FeedEventMilestone, "usage", nil, 
                fmt.Sprintf("Used %.0fGB of proxy bandwidth", m.ThresholdGB), nil)
            
            // Send notification
            NotifyUser(session.UserID, NotificationTypeMilestone, gin.H{
                "milestone": m,
                "provider_id": session.ProviderID,
                "prompt_review": true,
            })
            
            // WebSocket real-time
            ws.BroadcastToUser(session.UserID.String(), ws.MsgTypeMilestone, gin.H{
                "threshold": m.ThresholdGB,
                "reward": m.Reward,
                "provider": session.ProviderID,
            })
        }
    }
}
```

#### Feature 2: Low Balance Alerts with Social Context

```
┌─────────────────────────────────────────┐
│ ⚠️ Low Balance Alert                    │
├─────────────────────────────────────────┤
│                                         │
│ Your proxy session has 5GB remaining.  │
│                                         │
│ 💬 @Provider sent a message:           │
│ "I see you're running low. Want me     │
│  to extend with 10% off?"              │
│                                         │
│ [View Message] [Auto-Refill] [+10GB]   │
│                                         │
└─────────────────────────────────────────┘
```

**Provider Dashboard View:**
```
┌─────────────────────────────────────────┐
│ 📊 Your Customers' Usage                │
├─────────────────────────────────────────┤
│                                         │
│ @Buyer123                               │
│ ├─ Used: 45GB / 50GB (90%)             │
│ ├─ Quality: ⭐⭐⭐⭐⭐                   │
│ └─ [Send Refill Offer]                 │
│                                         │
│ @AnotherBuyer                           │
│ ├─ Used: 8GB / 10GB (80%)              │
│ ├─ Quality: ⭐⭐⭐⭐                     │
│ └─ [Send Refill Offer]                 │
│                                         │
│ [Message All Low Balance]              │
│                                         │
└─────────────────────────────────────────┘
```

#### Feature 3: Session-Based Chat Thread

In pay-as-you-go, the conversation continues throughout the session:

```typescript
// Thread includes lifecycle events
interface SessionChatThread {
    sessionId: string;
    messages: Message[];
    lifecycleEvents: LifecycleEvent[];
}

interface LifecycleEvent {
    type: 'purchase' | 'usage_milestone' | 'low_balance' | 'refill' | 'quality_alert';
    timestamp: Date;
    data: any;
}

// Example thread:
[
    { type: 'message', from: 'buyer', content: 'Hi, interested in US proxy' },
    { type: 'message', from: 'provider', content: 'Sure! What usage?' },
    { type: 'purchase', amount: '10GB', price: '$50' },
    { type: 'message', from: 'system', content: 'Session activated! Credentials sent.' },
    { type: 'usage_milestone', threshold: '5GB used' },
    { type: 'message', from: 'buyer', content: 'Speed is great!' },
    { type: 'low_balance', remaining: '2GB' },
    { type: 'message', from: 'provider', content: 'Want to refill? 10% off' },
    { type: 'refill', amount: '10GB', price: '$45' },
]
```

### 2.3 Provider-Buyer Relationship Tracking

In pay-as-you-go, you want to track the **ongoing relationship**, not just single orders:

```sql
-- New table: Ongoing provider-buyer relationships
CREATE TABLE provider_buyer_relationships (
    id UUID PRIMARY KEY,
    provider_id UUID REFERENCES users(id),
    buyer_id UUID REFERENCES users(id),
    first_order_at TIMESTAMP,
    last_active_at TIMESTAMP,
    total_sessions INT DEFAULT 0,
    total_bandwidth_gb DECIMAL(10,2) DEFAULT 0,
    total_spent DECIMAL(10,2) DEFAULT 0,
    avg_rating DECIMAL(2,1),
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'inactive', 'vip'
    
    UNIQUE(provider_id, buyer_id)
);

-- Index for provider dashboard
CREATE INDEX idx_relationships_provider ON provider_buyer_relationships(provider_id, last_active_at DESC);
```

**Provider View of Relationship:**
```
┌─────────────────────────────────────────┐
│ Relationship with @Buyer123             │
├─────────────────────────────────────────┤
│                                         │
│ 📊 Stats:                               │
│ • Customer since: Jan 15, 2026         │
│ • Total sessions: 12                   │
│ • Total bandwidth: 234GB               │
│ • Total revenue: $1,170                │
│ • Last active: 2 hours ago             │
│                                         │
│ ⭐ Average rating: 4.8/5               │
│                                         │
│ 🏷️ Status: VIP Customer                │
│                                         │
│ 💬 Recent messages:                     │
│ "Can I get a discount on next refill?" │
│                                         │
│ [Send Offer] [View History] [Message]  │
│                                         │
└─────────────────────────────────────────┘
```

---

## 3. Revised Social Integration Points

### 3.1 Explorer Integration (Revised for PAYG)

**Proxy Card - Pay-As-You-Go Edition:**
```
┌─────────────────────────────────────────┐
│  🌐 US Residential Proxy               │
│  $5/GB • Pay-as-you-go                 │
│                                         │
│  👤 @ProviderName 🟢 Online            │
│  ⭐ 4.8 (127 reviews)                  │
│  🏆 Top Seller • Fast Responder         │
│                                         │
│  📊 This Month:                        │
│  • 2.3TB served                        │
│  • 45 active customers                 │
│  • 99.9% uptime                        │
│                                         │
│  [Message] [Start Session]             │
└─────────────────────────────────────────┘
```

**Key Differences:**
- Shows "active customers" (ongoing) vs "sold" (one-time)
- "Start Session" instead of "Buy"
- Monthly usage stats show provider activity

### 3.2 Session Creation Flow with Social

```
┌─────────────────────────────────────────────────────┐
│ Start New Proxy Session                             │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Proxy: US Residential - New York                   │
│ Provider: @ProviderName ⭐ 4.8                     │
│                                                     │
│ Bandwidth: [10 GB ▼]                               │
│ Estimated cost: $50.00                              │
│                                                     │
│ 💬 Message to provider (optional):                 │
│ [Planning to use for web scraping...]              │
│                                                     │
│ ☑️ Auto-refill when low (recommended)              │
│                                                     │
│ [Start Session - $50.00]                           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**After Session Start:**
```
┌─────────────────────────────────────────┐
│ ✅ Session Started!                     │
├─────────────────────────────────────────┤
│                                         │
│ Your proxy is ready:                    │
│ • Endpoint: proxy.proxyhubb.com:8080   │
│ • Credentials: user_123 / pass_456     │
│ • Bandwidth: 10GB available            │
│                                         │
│ 💬 @Provider says:                     │
│ "Thanks! Let me know if you need help  │
│  with configuration."                  │
│                                         │
│ [View Chat] [Dashboard] [Test Proxy]   │
│                                         │
└─────────────────────────────────────────┘
```

### 3.3 Active Session Dashboard with Social

```
┌─────────────────────────────────────────────────────────────┐
│ My Active Sessions                              [+ New]    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ 🌐 US Residential (New York)                 [Details] ││
│ │                                                         ││
│ │ Provider: @ProviderName 🟢                    [Message]││
│ │                                                         ││
│ │ Usage: ████████████░░░░░░░░░░ 12GB / 20GB (60%)        ││
│ │                                                         ││
│ │ Speed: 45 Mbps │ Uptime: 99.2% │ Latency: 23ms        ││
│ │                                                         ││
│ │ 💬 3 unread messages from provider                     ││
│ │                                                         ││
│ │ [Extend Session] [Auto-Refill: ON] [Settings]          ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Pay-As-You-Go Review System

### 4.1 When to Ask for Reviews

**Don't:** Ask immediately after purchase (no usage yet)  
**Do:** Ask after meaningful usage

**Review Triggers:**

| Trigger | Timing | Context |
|---------|--------|---------|
| **First Usage** | After 1GB used | "How's your experience so far?" |
| **Milestone** | After 10GB, 100GB | "You've been using this for a while..." |
| **Refill** | When they refill | "You came back! How's it going?" |
| **Session End** | When session expires | "Session ended. Share your experience?" |
| **Support Resolution** | After provider helps | "Provider helped you. Rate the support?" |

### 4.2 Session-Aware Review Modal

```
┌─────────────────────────────────────────┐
│ ⭐ Rate Your Experience                 │
├─────────────────────────────────────────┤
│                                         │
│ Session: US Residential Proxy          │
│ Duration: 15 days                      │
│ Total used: 45GB                       │
│ Provider: @ProviderName                │
│                                         │
│ Overall: ⭐ ⭐ ⭐ ⭐ ⭐                 │
│                                         │
│ Categories:                             │
│ Speed:        ⭐⭐⭐⭐⭐               │
│ Reliability:  ⭐⭐⭐⭐⭐               │
│ Support:      ⭐⭐⭐⭐⭐               │
│ Value:        ⭐⭐⭐⭐⭐               │
│                                         │
│ Would you use this provider again?     │
│ [Definitely] [Maybe] [No]              │
│                                         │
│ Share your experience (optional):      │
│ [Great for web scraping, consistent    │
│  speeds... ]                           │
│                                         │
│ ☑️ Post to feed (help others discover) │
│                                         │
│ [Submit Review]                        │
│                                         │
│ 💰 Earn $5 credit for detailed review! │
└─────────────────────────────────────────┘
```

### 4.3 Provider Review Dashboard

```
┌─────────────────────────────────────────┐
│ 📊 Review Analytics                     │
├─────────────────────────────────────────┤
│                                         │
│ Overall: ⭐ 4.8 (127 reviews)          │
│                                         │
│ Breakdown by usage:                     │
│ • Light users (<10GB):  ⭐ 4.9          │
│ • Regular (10-100GB):   ⭐ 4.8          │
│ • Heavy (100GB+):       ⭐ 4.7          │
│                                         │
│ Breakdown by use case:                  │
│ • Web Scraping: ⭐ 4.9 (89 reviews)     │
│ • VPN:          ⭐ 4.7 (23 reviews)     │
│ • Gaming:       ⭐ 4.6 (15 reviews)     │
│                                         │
│ Recent reviews:                         │
│ ⭐⭐⭐⭐⭐ "Used 200GB over 2 months..."│
│ ⭐⭐⭐⭐⭐ "Consistent speeds, great..." │
│                                         │
│ [Reply to Reviews]                     │
│                                         │
└─────────────────────────────────────────┘
```

---

## 5. Circles for Pay-As-You-Go

### 5.1 Circle Bandwidth Pooling

**Use Case:** Small providers pool resources to compete with big players

```
┌─────────────────────────────────────────────────────┐
│ 🏢 Circle: "Asia-Pacific Alliance"                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Members: 5 providers                                │
│ Combined pool: 50TB available                       │
│                                                     │
│ Your contribution: 5TB (10%)                        │
│ Your earnings: $2,340 this month                    │
│                                                     │
│ Pool usage: ████████████████████░░░░ 82%           │
│ Active customers: 156                               │
│                                                     │
│ Recent activity:                                    │
│ • @Alice added 2TB to pool (2h ago)                │
│ • @Bob's customer used 500GB (5h ago)              │
│ • New enterprise inquiry received (1d ago)         │
│                                                     │
│ 💬 Circle Chat [5 unread]                          │
│ 📊 Shared Analytics                                │
│ 💰 Revenue Share: $468 owed to you                 │
│                                                     │
│ [Request Enterprise Quote] [Manage Pool]           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 5.2 Pay-As-You-Go within Circles

```go
// Circle session can draw from pool
type CircleSession struct {
    ID          uuid.UUID
    CircleID    uuid.UUID
    BuyerID     uuid.UUID
    ProviderID  uuid.UUID // Primary provider (point of contact)
    PoolSources []PoolSource // Multiple providers can serve
    TotalGB     float64
    UsedGB      float64
    Status      string // 'active', 'paused', 'completed'
}

type PoolSource struct {
    ProviderID uuid.UUID
    AllocatedGB float64
    UsedGB      float64
    EarnedUSD   float64
}

// When buyer uses proxy, traffic routes to available pool member
func routeTraffic(session CircleSession, request ProxyRequest) {
    // Find provider in pool with capacity
    provider := selectFromPool(session.PoolSources)
    
    // Track usage
    provider.UsedGB += request.SizeGB
    provider.EarnedUSD = provider.UsedGB * pool.PricePerGB * provider.SharePercent
    
    // Update in real-time
    ws.BroadcastToProvider(provider.ProviderID, "pool_usage", provider)
}
```

---

## 6. Implementation Priority (Pay-As-You-Go)

### Phase 1: Core Session + Messaging (Weeks 1-2)

**Must-Have for PAYG:**

1. **Session-Aware Chat Thread**
   ```typescript
   // Every session has persistent chat
   interface Session {
     id: string;
     chatThreadId: string; // Link to conversation
     providerId: string;
     buyerId: string;
     status: 'active' | 'low_balance' | 'expired';
   }
   ```

2. **Quick Message from Explorer**
   - Same as before, but context includes "pay-as-you-go"
   - Provider knows buyer is asking about usage-based pricing

3. **Provider-Buyer Relationship Tracking**
   ```sql
   CREATE TABLE provider_buyer_relationships (...)
   ```

### Phase 2: Usage Milestones (Weeks 3-4)

1. **Milestone Detection Worker**
   - Check usage every 5 minutes
   - Trigger celebrations at 1GB, 10GB, 100GB, etc.

2. **Low Balance Alerts with Social**
   - Provider can see who's low
   - Can proactively message with offers

3. **Auto-Refill Flow**
   - Seamless continuation of session
   - Chat thread persists across refills

### Phase 3: Reviews (Weeks 5-6)

1. **Usage-Based Review Triggers**
   - Not on purchase
   - On 1GB used, 10GB used, session end, refill

2. **Session-Aware Reviews**
   - Review shows "Used 45GB over 15 days"
   - More credible than "bought and didn't use"

### Phase 4: Circles (Weeks 7-8)

1. **Bandwidth Pooling UI**
   - Providers can join/create circles
   - Pool bandwidth for enterprise customers

2. **Revenue Sharing**
   - Automatic distribution based on contribution
   - Transparent accounting

---

## 7. Key Technical Changes for PAYG

### 7.1 Database Schema Additions

```sql
-- Track ongoing relationships (not just orders)
CREATE TABLE provider_buyer_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES users(id),
    buyer_id UUID NOT NULL REFERENCES users(id),
    first_session_at TIMESTAMP NOT NULL,
    last_session_at TIMESTAMP,
    total_sessions INT DEFAULT 0,
    total_bandwidth_gb DECIMAL(10,2) DEFAULT 0,
    total_spent DECIMAL(10,2) DEFAULT 0,
    relationship_score INT DEFAULT 0, -- Calculated
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(provider_id, buyer_id)
);

-- Milestone tracking
CREATE TABLE usage_milestones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    provider_id UUID REFERENCES users(id),
    milestone_type VARCHAR(50), -- 'first_gb', 'hundred_gb', 'tb_club'
    threshold_gb DECIMAL(10,2),
    achieved_at TIMESTAMP DEFAULT NOW(),
    reward_claimed BOOLEAN DEFAULT false,
    reward_amount DECIMAL(10,2)
);

-- Enhance sessions with social features
ALTER TABLE sessions ADD COLUMN conversation_id UUID REFERENCES conversations(id);
ALTER TABLE sessions ADD COLUMN review_prompted BOOLEAN DEFAULT false;
ALTER TABLE sessions ADD COLUMN review_prompted_at TIMESTAMP;
```

### 7.2 API Endpoints

```go
// New PAYG-social endpoints

// Get relationship between provider and buyer
GET /relationships/:providerId/:buyerId
Response: {
  "relationship": {
    "first_session_at": "2026-01-15",
    "total_sessions": 12,
    "total_bandwidth_gb": 234,
    "total_spent": 1170,
    "status": "vip"
  },
  "current_session": {...},
  "chat_thread": {...}
}

// Provider views their customer relationships
GET /provider/customers
Query params: ?status=active|vip|inactive&sort=last_session

// Get usage milestones for user
GET /users/:id/milestones

// Provider sends refill offer
POST /sessions/:id/refill-offers
Body: {
  "bonus_gb": 5,
  "discount_percent": 10,
  "message": "Thanks for being a loyal customer!"
}
```

### 7.3 WebSocket Events for PAYG

```go
const (
    // Session lifecycle
    MsgTypeSessionStarted    = "session_started"
    MsgTypeSessionExtended   = "session_extended"
    MsgTypeSessionLowBalance = "session_low_balance"
    MsgTypeSessionExpired    = "session_expired"
    
    // Usage events
    MsgTypeUsageMilestone    = "usage_milestone"
    MsgTypeUsageUpdate       = "usage_update" // Real-time GB usage
    
    // Provider-buyer interaction
    MsgTypeRefillOffer       = "refill_offer"
    MsgTypeRefillAccepted    = "refill_accepted"
    
    // Reviews
    MsgTypeReviewPrompt      = "review_prompt"
)
```

---

## 8. Summary: Pay-As-You-Go Social System

### Key Principles:

1. **Relationships > Transactions**
   - Track ongoing provider-buyer relationships
   - Reward loyalty and consistent quality

2. **Usage-Based Engagement**
   - Celebrate milestones (1GB, 10GB, 100GB, 1TB)
   - Prompt reviews after meaningful usage
   - Proactive communication at low balance

3. **Session-Centric Chat**
   - Single conversation thread throughout session lifecycle
   - Context-aware (shows usage, balance, history)

4. **Provider Empowerment**
   - See customer usage patterns
   - Proactively offer refills
   - Build VIP relationships

5. **Circle Collaboration**
   - Pool bandwidth for enterprise deals
   - Share customers across trusted providers
   - Revenue sharing based on actual usage

### Success Metrics for PAYG Social:

| Metric | Target |
|--------|--------|
| Sessions with ongoing chat | 70% |
| Refill rate (social vs no-social) | +30% |
| Provider response time | < 15 min |
| Reviews per 100GB usage | 1 |
| VIP relationships per provider | 10+ |
| Circle participation | 30% of providers |

---

**The Bottom Line:** In pay-as-you-go, social features aren't just about discovery—they're about **retention, loyalty, and ongoing value creation** between providers and buyers.
