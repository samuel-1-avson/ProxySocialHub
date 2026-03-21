# Pay-As-You-Go Social System Summary

## Key Insight: PAYG = Ongoing Relationships

**Traditional e-commerce social:**
- Focus: One-time purchase → Review → Done
- Chat: Pre-sale only
- Reviews: After delivery

**Pay-as-you-go social:**
- Focus: Continuous usage → Refill → Extend → Build trust
- Chat: Throughout entire lifecycle
- Reviews: After meaningful usage (1GB+, 10GB+, etc.)

---

## What Changes

| Feature | Before (One-Time) | After (PAYG) |
|---------|------------------|--------------|
| **Chat thread** | Ends after purchase | Continues through usage, refills, support |
| **Review timing** | After delivery | After 1GB used, 10GB, session end |
| **Provider view** | "Sold 100" | "234GB served, 12 active sessions" |
| **Social proof** | Stars + review count | Usage stats + relationship length |
| **Notifications** | Order confirmation | Low balance, milestones, refill offers |

---

## Critical Features for PAYG

### 1. Session-Aware Chat
Every proxy session has a persistent chat thread:
```
Buyer: "Hi, interested in US proxy"
Provider: "Sure! What usage?"
[System]: Session started - 10GB
Buyer: "Speed is great!"
[Milestone]: 5GB used!
[System]: Low balance - 2GB remaining
Provider: "Want 10% off refill?"
Buyer: [Refills 10GB]
[Review prompt]: You've used 15GB, how's it going?
```

### 2. Usage Milestones
Celebrate when users hit usage thresholds:
- 1GB: "First Steps" badge
- 10GB: "Power User" + $5 credit
- 100GB: "Bandwidth Champion"
- 1TB: "1TB Club"

### 3. Low Balance Social
Provider can see customers running low and proactively message:
```
Provider Dashboard:
├─ @Buyer123: 45GB / 50GB used (90%)
│  └─ [Send Refill Offer]
├─ @Another: 8GB / 10GB used (80%)
│  └─ [Send Refill Offer]
└─ [Message All Low Balance]
```

### 4. Relationship Tracking
Track ongoing provider-buyer relationships:
```sql
provider_buyer_relationships:
- provider_id, buyer_id
- first_session_at, last_session_at
- total_sessions, total_bandwidth_gb, total_spent
- status: 'active', 'vip', 'inactive'
```

### 5. Reviews After Usage
Don't ask for review immediately. Ask after:
- 1GB used (first impression)
- 10GB used (meaningful usage)
- Session ends
- Refill (they came back!)

---

## Implementation Priority

### Week 1-2: Foundation
- [ ] Add `conversation_id` to sessions table
- [ ] Create `provider_buyer_relationships` table
- [ ] Link chat to sessions
- [ ] Show session-aware chat in dashboard

### Week 3-4: Usage Milestones
- [ ] Milestone tracking worker
- [ ] Low balance detection
- [ ] Provider "low balance" dashboard
- [ ] Refill offer messaging

### Week 5-6: Reviews
- [ ] Usage-based review triggers
- [ ] Session-aware review modal
- [ ] Review analytics for providers

### Week 7-8: Circles
- [ ] Bandwidth pooling
- [ ] Revenue sharing
- [ ] Enterprise quotes

---

## Quick Wins (Start Here)

### 1. Add "Message Provider" to Proxy Cards
Already planned, but context should be PAYG-aware.

### 2. Show "Active Sessions" Instead of "Sold"
```
Change: "127 sold"
To: "45 active • 234GB served this month"
```

### 3. Session Chat in Dashboard
Add chat widget to active session cards.

### 4. Low Balance Notifications
Alert users at 20% remaining, with one-click refill.

---

## Success Metrics

| Metric | Current | 3-Month Goal |
|--------|---------|--------------|
| Avg session duration | ? | +40% |
| Refill rate | ? | +30% |
| Provider response time | ? | < 15 min |
| Sessions with chat | ? | 70% |
| Reviews per 100GB | 0 | 1 |

---

**Bottom line:** In PAYG, social features drive **retention and refill rates**, not just discovery.
