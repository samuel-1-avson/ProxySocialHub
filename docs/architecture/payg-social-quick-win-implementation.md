# Pay-As-You-Go Social Quick Win - Implementation Summary

**Date:** March 19, 2026  
**Scope:** Option A - Quick Win (1 Week)  
**Status:** ✅ Implementation Complete

---

## What Was Implemented

### 1. Database Changes

**File:** `migrations/20260319110000_add_conversation_to_sessions.sql`

Added:
- `conversation_id` to `sessions` table - Links sessions to persistent chat threads
- `provider_buyer_relationships` table - Tracks ongoing relationships (not just orders)
- `usage_milestones` table - For gamification (1GB, 10GB, 100GB achievements)
- `active_sessions_count` to `proxy_listings` - Shows live usage
- `is_online` and `last_seen_at` to `users` - Provider presence

### 2. Backend API Changes

**File:** `services/control-api/internal/api/listing_social.go` (New)

New endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /listings/:id/social` | Get social context (active sessions, provider online status, etc.) |
| `POST /listings/:id/inquire` | Send message to provider about listing |
| `GET /listings/:id/qa` | Get Q&A for listing |
| `POST /listings/:id/qa` | Ask question about listing |
| `GET /provider/relationships` | Provider views their buyer relationships |
| `POST /provider/relationships/:buyerId/offer` | Send refill offer to buyer |
| `POST /presence/heartbeat` | Update online status |
| `GET /users/:id/presence` | Check if user is online |

**File:** `services/control-api/internal/models/relationships.go` (New)

Added models:
- `ProviderBuyerRelationship` - Tracks ongoing provider-buyer relationships
- `UsageMilestone` - Gamification milestones

**File:** `services/control-api/internal/models/session.go` (Modified)

Added:
- `ConversationID` - Links session to conversation
- `ReviewPrompted` - Tracks if review was prompted
- `Conversation` relation

**File:** `services/control-api/internal/models/listing.go` (Modified)

Added:
- `ActiveSessionsCount` - Live count of active sessions
- `AllowDirectMessage` - Provider can disable messages

**File:** `services/control-api/internal/models/user.go` (Modified)

Added:
- `IsOnline` - Real-time presence
- `LastSeenAt` - Last activity timestamp

### 3. Frontend Components

**File:** `apps/web/src/components/QuickMessageModal.tsx` (New)

Features:
- Context-aware messaging from listing
- Intent selection (Web Scraping, VPN, Gaming, etc.)
- Expected usage selection
- Provider online status indicator
- Pre-filled message templates

**File:** `apps/web/src/components/ListingCardEnhanced.tsx` (New)

Enhanced proxy card with:
- Provider online indicator (green dot)
- Active sessions count ("5 active")
- Response time estimate
- **"Ask" button** - 1-click message to provider
- Total sessions served (PAYG metric)

**File:** `apps/web/src/components/ui/textarea.tsx` (New)

Basic textarea component for the message modal.

---

## Key Features

### 1. 1-Click Messaging from Explorer

**Before:**
```
See Proxy → Click Buy → Navigate to Messages → Find Provider → Start Chat
```

**After:**
```
See Proxy → Click "Ask" → Message Modal Opens → Send Message
```

### 2. Active Sessions Display

Shows "5 active" instead of just "sold count" - reflects PAYG ongoing usage.

### 3. Provider Online Status

- Green dot with pulse animation when online
- Shows "Online" / "Offline" status
- Response time estimate ("~15m response")

### 4. Context-Aware Conversations

When messaging from a listing:
- Pre-filled with listing context
- Intent captured (Web Scraping, VPN, etc.)
- Expected usage captured
- Links conversation to listing

---

## Usage

### For Buyers

1. Browse proxies in explorer
2. See provider online status + active sessions
3. Click **"Ask"** button on any listing
4. Select intent (Web Scraping, VPN, etc.)
5. Select expected usage
6. Send message
7. Provider gets real-time notification

### For Providers

1. Go online (heartbeat updates status)
2. Receive inquiries with context:
   - What buyer wants (intent)
   - How much they'll use
   - Which listing they're interested in
3. Respond via existing message system
4. See buyer relationships dashboard

---

## Integration Points

### To Use Enhanced Listing Card

Replace `ListingCard` with `ListingCardEnhanced`:

```typescript
// In your explorer/marketplace page
import { ListingCardEnhanced } from '@/components/ListingCardEnhanced';

// Instead of:
<ListingCard listing={listing} onSelect={handleSelect} />

// Use:
<ListingCardEnhanced listing={listing} onSelect={handleSelect} />
```

### API Integration

The enhanced card automatically fetches social context:

```typescript
// Fetched on mount:
GET /api/v1/listings/${listing.id}/social

// Returns:
{
  "listing_id": "...",
  "active_sessions_count": 5,
  "total_sessions_count": 127,
  "allow_direct_message": true,
  "provider": {
    "is_online": true,
    "avg_rating": 4.8,
    "response_time_min": 15
  },
  "is_followed": false,
  "has_existing_session": false
}
```

---

## Next Steps (After Quick Win)

### Phase 2: Usage Milestones (Week 3-4)
- Implement milestone detection worker
- Low balance alerts with provider offers
- Auto-refill flow

### Phase 3: Reviews (Week 5-6)
- Usage-based review triggers (after 1GB, 10GB)
- Session-aware review modal

### Phase 4: Circles (Week 7-8)
- Bandwidth pooling UI
- Revenue sharing

---

## Files Modified/Created

```
Database:
├── migrations/20260319110000_add_conversation_to_sessions.sql (NEW)

Backend:
├── services/control-api/internal/models/relationships.go (NEW)
├── services/control-api/internal/models/session.go (MODIFIED)
├── services/control-api/internal/models/listing.go (MODIFIED)
├── services/control-api/internal/models/user.go (MODIFIED)
├── services/control-api/internal/api/listing_social.go (NEW)
├── services/control-api/main.go (MODIFIED - route registration)

Frontend:
├── apps/web/src/components/QuickMessageModal.tsx (NEW)
├── apps/web/src/components/ListingCardEnhanced.tsx (NEW)
├── apps/web/src/components/ui/textarea.tsx (NEW)

Documentation:
├── docs/architecture/pay-as-you-go-social-quick-win-implementation.md (THIS FILE)
```

---

## Testing Checklist

- [ ] Database migration runs successfully
- [ ] `GET /api/v1/listings/:id/social` returns correct data
- [ ] `POST /api/v1/listings/:id/inquire` creates conversation
- [ ] Online status updates with heartbeat
- [ ] QuickMessageModal opens from listing card
- [ ] Message sends with correct context
- [ ] Provider receives WebSocket notification
- [ ] Active sessions count displays correctly

---

## Rollback Plan

If issues occur:

1. **Revert database:**
   ```sql
   ALTER TABLE sessions DROP COLUMN conversation_id;
   DROP TABLE provider_buyer_relationships;
   DROP TABLE usage_milestones;
   ```

2. **Revert frontend:**
   - Replace `ListingCardEnhanced` with original `ListingCard`

3. **Revert backend:**
   - Remove `RegisterListingSocialRoutes` call from main.go

---

## Success Metrics

Track these after deployment:

| Metric | Baseline | Target |
|--------|----------|--------|
| Messages sent from explorer | 0 | >10/day |
| Provider response rate | ? | >70% |
| Avg response time | ? | <30 min |
| Active sessions displayed | N/A | Real-time |

---

**Implementation Complete!** 🎉

The social system is now integrated with the PAYG model, allowing seamless provider-buyer communication directly from the proxy explorer.
