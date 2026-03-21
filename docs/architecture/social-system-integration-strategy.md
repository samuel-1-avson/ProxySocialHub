# ProxyHubb Social System Integration Strategy

**Vision:** Transform social features from standalone modules into the connective tissue of the entire platform, making proxy discovery, provisioning, and trading a seamless social experience.

**Date:** March 19, 2026  
**Status:** Strategic Roadmap

---

## Part 1: Review of Your Ideas

### ✅ What You Got Right

| Your Idea | Why It's Correct | Impact Level |
|-----------|------------------|--------------|
| **"Not standalone"** | Current social is isolated; needs to be contextually embedded | 🔴 Critical |
| **Provider sharing nodes** | Creates organic discovery + trust through transparency | 🔴 Critical |
| **Message from explorer** | Removes friction in buyer-seller communication | 🔴 Critical |
| **"Seamlessly merged"** | Social should enhance core flows, not compete | 🟡 High |
| **Proxy posting/sharing** | Network effect - more eyes on listings = more sales | 🟡 High |

### 🎯 The Core Insight

You've identified the **fundamental problem**: Currently, a user has to:
1. Discover proxy in Explorer (context: buying)
2. Navigate to Messages (context: social)
3. Find provider (context: search)
4. Start conversation (context: social)

**Your Solution:** Make it **1 click** from proxy discovery to conversation.

---

## Part 2: The "Social Fabric" Architecture

### 2.1 Integration Philosophy

```
┌─────────────────────────────────────────────────────────────┐
│                    SOCIAL FABRIC LAYER                       │
│  (Presence, Trust, Communication, Discovery)                │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Explorer │  │Marketplace│  │ Provider │  │  Orders  │    │
│  │          │  │          │  │ Dashboard│  │          │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│         │            │            │            │            │
│         └────────────┴────────────┴────────────┘            │
│                         │                                   │
│              ┌──────────┴──────────┐                        │
│              │   Core Proxy Engine  │                        │
│              │ (Nodes, Sessions,    │                        │
│              │  Routing, Billing)   │                        │
│              └─────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Five Integration Pillars

| Pillar | Description | Example |
|--------|-------------|---------|
| **Contextual Presence** | Show who's online/available where it matters | Provider online indicator on proxy card |
| **Trust Layer** | Reviews, badges, testimonials visible everywhere | Badge icons on proxy listings |
| **Frictionless Communication** | 1-click contact from any context | "Message Provider" on proxy detail |
| **Social Discovery** | Share and discover through network | "Providers you follow have new listings" |
| **Collaborative Provisioning** | Circles/teams for proxy operations | Circle pool bandwidth for enterprise |

---

## Part 3: Feature Integration Roadmap

### Phase 1: Explorer + Social (Immediate - P0)

#### 3.1.1 Proxy Card Social Elements

**Current Proxy Card:**
```
┌─────────────────────────┐
│  🌐 US Residential      │
│  99.2% Uptime          │
│  $5/GB                 │
│  [Buy Now]             │
└─────────────────────────┘
```

**Enhanced Proxy Card:**
```
┌─────────────────────────┐
│  🌐 US Residential      │
│  ⭐ 4.8 (127 reviews)   │ ← Live review count
│  👤 @ProviderName       │ ← Clickable profile
│  🟢 Online              │ ← Presence indicator
│  🏆 Top Seller          │ ← Badge display  
│  $5/GB                 │
│  [Message] [Buy Now]   │ ← Direct messaging
└─────────────────────────┘
```

**Implementation:**
```typescript
// apps/web/src/components/proxy/ProxyCard.tsx
interface ProxyCardProps {
  listing: ProxyListing;
  showSocial?: boolean; // New prop
}

// Add social section
<div className="proxy-social-bar">
  <ProviderPresence providerId={listing.seller_id} />
  <ProviderRating rating={listing.seller.avg_rating} count={listing.seller.reviews_count} />
  <QuickMessageButton 
    providerId={listing.seller_id} 
    listingId={listing.id}
    buttonText="Ask About This"
  />
</div>
```

#### 3.1.2 Proxy Detail Page - Social Sidebar

**Layout:**
```
┌────────────────────────────────────────────────────┐
│ Proxy Details          │ Provider Card             │
│                        │                           │
│ - Location             │ [Avatar] @Provider        │
│ - Speed Graph          │ ⭐ 4.8 (127 reviews)      │
│ - Uptime Stats         │ 🏆 Badges: Top Seller     │
│ - Price History        │ 📊 2.3TB Sold             │
│                        │ 🟢 Online Now             │
│ [Buy: $50]             │                           │
│                        │ [Message About Proxy]     │
│                        │ [View Profile]            │
│                        │ [Follow Provider]         │
└────────────────────────────────────────────────────┘
```

**Backend Changes:**
```go
// services/control-api/internal/api/explorer.go

// Enhance listing response with social data
type ListingWithSocial struct {
    models.ProxyListing
    Seller      SellerSocialProfile `json:"seller"`
    Reviews     []ReviewPreview     `json:"recent_reviews"`
    IsFollowed  bool                `json:"is_followed"` // If viewer follows seller
}

type SellerSocialProfile struct {
    ID              uuid.UUID `json:"id"`
    Username        string    `json:"username"`
    DisplayName     string    `json:"display_name"`
    AvatarURL       string    `json:"avatar_url"`
    AvgRating       float64   `json:"avg_rating"`
    ReviewsCount    int       `json:"reviews_count"`
    Badges          []Badge   `json:"badges"`
    IsOnline        bool      `json:"is_online"`
    ResponseTimeMin int       `json:"response_time_min"`
}

// GET /explorer/listings/:id - Enhanced with social
func getListingDetail(c *gin.Context) {
    // ... existing code ...
    
    // Add social context
    var isFollowed bool
    if currentUserID != "" {
        db.Social().Model(&models.Follow{}).
            Where("follower_id = ? AND following_id = ?", currentUserID, listing.SellerID).
            Count(&followCount)
        isFollowed = followCount > 0
    }
    
    // Get seller badges
    var badges []models.Badge
    db.Social().
        Joins("JOIN user_badges ON user_badges.badge_id = badges.id").
        Where("user_badges.user_id = ?", listing.SellerID).
        Find(&badges)
    
    c.JSON(http.StatusOK, ListingWithSocial{
        ProxyListing: listing,
        Seller:       buildSellerProfile(listing.Seller, badges),
        IsFollowed:   isFollowed,
    })
}
```

#### 3.1.3 Quick-Start Conversation from Proxy

**User Flow:**
1. User sees proxy in explorer
2. Clicks "Message Provider"
3. Modal opens with **pre-filled context**:
   ```
   ┌──────────────────────────────────┐
   │ Message @Provider about:         │
   │                                  │
   │ 🌐 US Residential Proxy          │
   │ 💰 $5/GB | 📍 New York           │
   │                                  │
   │ [--------------------------------]
   │ Hi, I'm interested in this proxy │
   │ for [dropdown: Web Scraping/VPN/ │
   │  Gaming/Marketing...]            │
   │                                  │
   │ My expected usage: ___ GB/month  │
   │                                  │
   │ [Send Message]                   │
   └──────────────────────────────────┘
   ```

**API Implementation:**
```go
// POST /conversations/from-listing
func startConversationFromListing(c *gin.Context) {
    var req struct {
        ListingID   uuid.UUID `json:"listing_id"`
        Message     string    `json:"message"`
        Intent      string    `json:"intent"`      // "web_scraping", "vpn", etc.
        ExpectedGB  float64   `json:"expected_gb"`
    }
    
    // Create or get existing conversation
    conversation := getOrCreateConversation(buyerID, sellerID, &listingID)
    
    // Create enriched first message
    message := models.Message{
        ConversationID: conversation.ID,
        SenderID:       buyerID,
        Content:        req.Message,
        Type:           "listing_inquiry",
        Metadata: map[string]interface{}{
            "listing_id":   req.ListingID,
            "intent":       req.Intent,
            "expected_gb":  req.ExpectedGB,
            "context":      "explorer",
        },
    }
    
    // Send WebSocket notification to seller
    ws.BroadcastToUser(sellerID.String(), ws.MsgTypeNewInquiry, gin.H{
        "conversation_id": conversation.ID,
        "listing_id":      req.ListingID,
        "buyer_preview":   getUserPreview(buyerID),
    })
}
```

---

### Phase 2: Provider Dashboard + Social (P0-P1)

#### 3.2.1 Node Provisioning Flow with Social Sharing

**Current Flow:**
```
Add Node → Configure → Save → Done
```

**Enhanced Social Flow:**
```
Add Node → Configure → Save → Social Share Options → Publish
                ↓
        ┌───────┴────────┐
        ↓                ↓
   [Share to Feed]   [Skip for Now]
        ↓
   Create announcement
   in your circles
   and followers' feeds
```

**Implementation:**
```typescript
// apps/web/src/components/node/NodeProvisionWizard.tsx

const [step, setStep] = useState<'config' | 'share' | 'done'>('config');
const [shareOptions, setShareOptions] = useState({
  postToFeed: true,
  circles: [] as string[],
  message: 'Just launched a new high-speed node in Tokyo! 🚀'
});

// After node creation
async function handleNodeCreated(node: Node) {
  if (shareOptions.postToFeed) {
    await createFeedEvent({
      type: 'node_online',
      targetId: node.id,
      content: shareOptions.message,
      circles: shareOptions.circles
    });
    
    // Also notify followers
    await notifyFollowers({
      type: 'new_node',
      nodeId: node.id,
      providerId: currentUser.id
    });
  }
  
  setStep('done');
}
```

#### 3.2.2 Provider Activity Feed

**Dashboard Widget:**
```
┌─────────────────────────────────────────┐
│ 📊 Provider Activity Feed               │
├─────────────────────────────────────────┤
│                                         │
│ 🟢 Node "Tokyo-01" is now online        │
│    2 minutes ago • 12 views             │
│                                         │
│ 💬 @Buyer asked about Tokyo Residential │
│    15 minutes ago • [Reply]             │
│                                         │
│ ⭐ New review: "Excellent speed!" 5★    │
│    1 hour ago • [View]                  │
│                                         │
│ 👤 @NewUser started following you       │
│    3 hours ago                          │
│                                         │
│ 📈 Sale: 50GB purchased ($250)          │
│    5 hours ago                          │
│                                         │
└─────────────────────────────────────────┘
```

**Backend:**
```go
// services/control-api/internal/api/provider_dashboard.go

func getProviderActivityFeed(c *gin.Context) {
    providerID := c.GetString("userID")
    
    // Aggregate from multiple sources
    var activities []Activity
    
    // Recent messages
    db.Social().
        Where("recipient_id = ? AND created_at > ?", providerID, time.Now().AddDate(0, -7, 0)).
        Find(&messages)
    
    // Recent reviews
    db.Social().
        Where("seller_id = ?", providerID).
        Order("created_at DESC").
        Limit(10).
        Find(&reviews)
    
    // New followers
    db.Social().
        Where("following_id = ?", providerID).
        Order("created_at DESC").
        Limit(10).
        Find(&follows)
    
    // Sales
    db.DB.
        Where("seller_id = ?", providerID).
        Order("created_at DESC").
        Limit(10).
        Find(&orders)
    
    // Merge and sort
    activities = mergeActivities(messages, reviews, follows, orders)
    
    c.JSON(http.StatusOK, gin.H{"activities": activities})
}
```

#### 3.2.3 Quick-Share Templates

When provider creates node, offer templates:

```typescript
const shareTemplates = [
  {
    id: 'new_node',
    text: '🚀 Just launched a new {nodeType} node in {location}! {bandwidth}GB bandwidth available.',
    emoji: '🚀'
  },
  {
    id: 'high_performance',
    text: '⚡ New high-performance proxy node! Latency: {latency}ms | Uptime: {uptime}%',
    emoji: '⚡'
  },
  {
    id: 'enterprise_ready',
    text: '🏢 Enterprise-grade {nodeType} now available! SOC2 compliant, dedicated support.',
    emoji: '🏢'
  },
  {
    id: 'promotion',
    text: '🎉 Special offer! {discount}% off for the first 10 buyers of my new {location} node.',
    emoji: '🎉'
  }
];
```

---

### Phase 3: Marketplace + Social (P1)

#### 3.3.1 Listing-Specific Conversations

**Contextual Threads:**
Every listing gets a "Questions & Answers" thread:

```
┌─────────────────────────────────────────┐
│ US Residential Proxy - $5/GB           │
├─────────────────────────────────────────┤
│ [Details] [Reviews] [💬 Q&A (3)]       │ ← Tab interface
├─────────────────────────────────────────┤
│                                         │
│ Q: Does this work with Instagram?      │
│ @Buyer123 • 2 days ago                  │
│                                         │
│ A: Yes, perfect for social media!      │
│    I've tested with IG, TikTok, X.     │
│ @Provider • 1 day ago ✅ Verified      │
│                                         │
│ Q: What's the average speed?           │
│ @AnotherBuyer • 5 hours ago            │
│                                         │
│ [Ask a Question...]                    │
└─────────────────────────────────────────┘
```

**Implementation:**
```go
// Listing Q&A uses forum_threads under the hood
// but displayed in listing context

type ListingQA struct {
    ID          uuid.UUID `json:"id"`
    ListingID   uuid.UUID `json:"listing_id"`
    Question    ForumPost `json:"question"`
    Answer      *ForumPost `json:"answer,omitempty"`
    IsAnswered  bool      `json:"is_answered"`
}

// GET /listings/:id/qa
func getListingQA(c *gin.Context) {
    listingID := c.Param("id")
    
    var qas []ListingQA
    db.Social().
        Where("listing_id = ?", listingID).
        Preload("Question.Author").
        Preload("Answer.Author").
        Find(&qas)
    
    c.JSON(http.StatusOK, gin.H{"qa": qas})
}
```

#### 3.3.2 Social Proof on Listings

**Enhanced Listing Page:**
```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  🌐 US Residential Proxy                           │
│  $5/GB                                             │
│                                                     │
│  ┌─────────────────────────────────────────┐       │
│  │ 👥 47 people viewing this now          │       │ ← Live presence
│  │ 🛒 12 purchased in last 24h            │       │ ← Activity feed
│  │ ⭐ 4.8/5 from 127 verified buyers      │       │ ← Reviews
│  └─────────────────────────────────────────┘       │
│                                                     │
│  [Message Provider] [Buy Now]                      │
│                                                     │
│  ── Recent Activity ──                             │
│  🟢 @User just purchased 10GB (2 min ago)         │
│  ⭐ @Buyer left a 5★ review (1 hour ago)          │
│  💬 @Someone asked a question (3 hours ago)       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

### Phase 4: Orders + Social (P1)

#### 3.4.1 Order Timeline with Social Touchpoints

```
┌─────────────────────────────────────────┐
│ Order #12345 Timeline                   │
├─────────────────────────────────────────┤
│                                         │
│ ●───────●───────●───────○───────○      │
│ Paid   Active  50%    100%   Review    │
│        ┃                              │
│        ┃ 💬 @Provider: "Your proxy     │
│        ┃    is ready! Let me know      │
│        ┃    if you need help."         │
│        ┃    [Reply]                    │
│        ┃                              │
│       50%                              │
│       Usage: 50GB / 100GB              │
│       Speed: 45 Mbps                   │
│                                         │
│ [Contact Provider] [Extend] [Review]   │ ← Contextual actions
│                                         │
└─────────────────────────────────────────┘
```

#### 3.4.2 Post-Order Review Flow

**Current:** User must remember to review

**Enhanced:** 
```
┌─────────────────────────────────────────┐
│ 🎉 Your order is complete!              │
├─────────────────────────────────────────┤
│                                         │
│ How was your experience with            │
│ @Provider?                              │
│                                         │
│ ⭐ ⭐ ⭐ ⭐ ⭐                          │
│                                         │
│ [Quick Review]                          │
│ ┌─────────────────────────────────┐    │
│ │ ⚡ Speed:     ⭐⭐⭐⭐⭐        │    │
│ │ 🔒 Reliability: ⭐⭐⭐⭐⭐        │    │
│ │ 🎧 Support:   ⭐⭐⭐⭐⭐          │    │
│ └─────────────────────────────────┘    │
│                                         │
│ Share your experience (optional):      │
│ [--------------------------------]     │
│                                         │
│ [Submit Review] [Ask a Question]       │
│                                         │
└─────────────────────────────────────────┘
```

**Implementation:**
```typescript
// Triggered on order completion webhook
function onOrderCompleted(order: Order) {
  // Show review modal
  showReviewModal({
    orderId: order.id,
    providerId: order.seller_id,
    listingId: order.listing_id,
    autoShow: true, // Show immediately
    incentives: {
      badge: 'First Reviewer',
      points: 100
    }
  });
  
  // Also send notification
  sendNotification({
    userId: order.buyer_id,
    type: 'review_prompt',
    title: 'How was your proxy experience?',
    action: '/orders/' + order.id + '/review'
  });
}
```

---

### Phase 5: Circles + Provider Collaboration (P2)

#### 3.5.1 Circle-Based Node Pooling

**Use Case:** 5 providers form a circle to offer enterprise-grade coverage

```
┌─────────────────────────────────────────────────────┐
│ 🏢 Enterprise Proxy Circle: "GlobalMesh"           │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Members: @Alice @Bob @Charlie @Dave @Eve           │
│ Combined Bandwidth: 50TB                           │
│ SLA: 99.99% Uptime Guarantee                       │
│                                                     │
│ 🌍 Coverage:                                       │
│ ┌─────────┬─────────┬─────────┬─────────┐         │
│ │  🇺🇸 US  │  🇪🇺 EU  │  🇯🇵 JP  │  🇸🇬 SG  │         │
│ │ 12TB   │ 15TB   │ 13TB   │ 10TB   │         │
│ └─────────┴─────────┴─────────┴─────────┘         │
│                                                     │
│ 💬 Circle Chat [3 unread]                          │
│ 📊 Shared Analytics                                │
│ ⚙️ Pool Management                                 │
│                                                     │
│ [Request Enterprise Quote]                         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

#### 3.5.2 Circle Announcements

When provider adds node, can announce to circles:

```go
// Auto-announce to circles
func announceNodeToCircles(node ProviderNode, provider User) {
    circles := getProviderCircles(provider.ID)
    
    for _, circle := range circles {
        event := models.FeedEvent{
            ActorID:    &provider.ID,
            EventType:  models.FeedEventCircleAnnounce,
            TargetType: "node",
            TargetID:   &node.ID,
            Content:    fmt.Sprintf("Added new %s node in %s to pool", node.Type, node.Location),
            Metadata: map[string]interface{}{
                "circle_id":    circle.ID,
                "node_type":    node.Type,
                "bandwidth_gb": node.BandwidthTotal,
            },
        }
        
        db.Social().Create(&event)
        
        // Notify circle members
        for _, member := range circle.Members {
            if member.UserID != provider.ID {
                ws.BroadcastToUser(member.UserID.String(), ws.MsgTypeCircleUpdate, event)
            }
        }
    }
}
```

---

## Part 4: Technical Implementation Guide

### 4.1 Database Changes

#### Add Social Context Columns

```sql
-- Enhance proxy_listings with social visibility
ALTER TABLE proxy_listings ADD COLUMN 
    social_share_enabled BOOLEAN DEFAULT true;

ALTER TABLE proxy_listings ADD COLUMN 
    allow_direct_message BOOLEAN DEFAULT true;

-- Track listing inquiries for analytics
CREATE TABLE listing_inquiries (
    id UUID PRIMARY KEY,
    listing_id UUID REFERENCES proxy_listings(id),
    buyer_id UUID REFERENCES users(id),
    provider_id UUID REFERENCES users(id),
    intent VARCHAR(50), -- 'web_scraping', 'vpn', 'gaming', etc.
    expected_gb DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT NOW(),
    converted_to_order BOOLEAN DEFAULT false
);

-- Index for analytics
CREATE INDEX idx_inquiries_listing ON listing_inquiries(listing_id, created_at);
CREATE INDEX idx_inquiries_provider ON listing_inquiries(provider_id, created_at);

-- Link forum threads to listings for Q&A
ALTER TABLE forum_threads ADD COLUMN 
    listing_id UUID REFERENCES proxy_listings(id);

CREATE INDEX idx_threads_listing ON forum_threads(listing_id) 
    WHERE listing_id IS NOT NULL;
```

### 4.2 API Enhancements

#### New Endpoints

```go
// services/control-api/internal/api/social_integration.go

func RegisterSocialIntegrationRoutes(rg *gin.RouterGroup) {
    // Explorer integration
    rg.GET("/explorer/listings/:id/social", getListingSocialContext)
    rg.POST("/explorer/listings/:id/inquire", createListingInquiry)
    
    // Provider dashboard
    rg.GET("/provider/activity-feed", getProviderActivityFeed)
    rg.POST("/provider/nodes/:id/announce", announceNodeToFeed)
    
    // Quick conversation
    rg.POST("/conversations/from-listing", startConversationFromListing)
    rg.GET("/listings/:id/qa", getListingQA)
    rg.POST("/listings/:id/qa", askListingQuestion)
    
    // Presence
    rg.GET("/users/:id/presence", getUserPresence)
    rg.POST("/presence/heartbeat", updatePresence)
}
```

#### Enhanced Existing Endpoints

```go
// Modify getListing to include social data
func getListing(c *gin.Context) {
    // ... existing code ...
    
    // Add social context
    listing.Social = &ListingSocialData{
        ReviewSummary: getReviewSummary(listing.ID),
        ProviderOnline: isUserOnline(listing.SellerID),
        IsFollowed: isFollowedBy(currentUserID, listing.SellerID),
        QuickStats: QuickStats{
            ViewsLast24h: getViewCount(listing.ID, 24*time.Hour),
            PurchasesLast24h: getPurchaseCount(listing.ID, 24*time.Hour),
            CurrentViewers: getActiveViewers(listing.ID),
        },
    }
}
```

### 4.3 Frontend Components

#### New Components to Build

```typescript
// apps/web/src/components/social/

// 1. ProxyCardSocial.tsx - Social bar for proxy cards
interface ProxyCardSocialProps {
  listingId: string;
  sellerId: string;
  showMessageButton?: boolean;
  compact?: boolean;
}

// 2. QuickMessageModal.tsx - Contextual messaging
interface QuickMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  listingId?: string;
  context?: 'explorer' | 'listing' | 'profile';
  prefillText?: string;
}

// 3. ProviderPresence.tsx - Online indicator
interface ProviderPresenceProps {
  providerId: string;
  showText?: boolean;
}

// 4. ActivityFeedWidget.tsx - Dashboard activity
interface ActivityFeedWidgetProps {
  providerId?: string; // If omitted, shows global
  limit?: number;
  types?: ActivityType[];
}

// 5. ListingQA.tsx - Q&A section for listings
interface ListingQAProps {
  listingId: string;
  allowQuestions?: boolean;
}

// 6. SocialShareModal.tsx - Share node/listing
interface SocialShareModalProps {
  type: 'node' | 'listing' | 'achievement';
  targetId: string;
  defaultMessage?: string;
}
```

#### Integration Points

```typescript
// Modify existing components to include social

// 1. ProxyCard.tsx - Add social bar
<ProxyCard>
  {/* ... existing ... */}
  <ProxyCardSocial 
    listingId={listing.id} 
    sellerId={listing.seller_id}
    showMessageButton={true}
  />
</ProxyCard>

// 2. ProxyDetailPage.tsx - Add sidebar
<div className="grid grid-cols-3">
  <div className="col-span-2">
    {/* ... existing proxy details ... */}
  </div>
  <div className="col-span-1">
    <ProviderSocialCard providerId={listing.seller_id} />
    <QuickContactButton listingId={listing.id} />
    <ListingQA listingId={listing.id} />
  </div>
</div>

// 3. NodeProvisionWizard.tsx - Add share step
<NodeProvisionWizard>
  <StepConfig />
  <StepSocialShare /> {/* NEW */}
  <StepConfirmation />
</NodeProvisionWizard>

// 4. OrderCompletionPage.tsx - Add review prompt
<OrderCompletionPage>
  <OrderSummary />
  <ReviewPromptModal orderId={order.id} autoShow={true} />
  <NextSteps />
</OrderCompletionPage>
```

### 4.4 WebSocket Events

```go
// Add new message types
const (
    // Existing
    MsgTypeNewMessage  = "new_message"
    MsgTypeNewOrder    = "new_order"
    
    // New social integration events
    MsgTypeNewInquiry      = "new_inquiry"       // Provider gets new inquiry
    MsgTypeListingView     = "listing_view"      // Real-time view counter
    MsgTypeProviderOnline  = "provider_online"   // Followed provider online
    MsgTypeCircleUpdate    = "circle_update"     // Circle pool changes
    MsgTypeReviewReceived  = "review_received"   // New review on listing
    MsgTypeQAReply         = "qa_reply"          // Answer to question
)

// Broadcast on specific actions
func onListingView(listingID, viewerID uuid.UUID) {
    ws.BroadcastToUser(listing.SellerID.String(), MsgTypeListingView, gin.H{
        "listing_id": listingID,
        "viewer_count": getActiveViewerCount(listingID),
    })
}
```

---

## Part 5: User Journey Maps

### 5.1 Buyer Journey (with Social)

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  DISCOVER   │───→│   EVALUATE  │───→│   CONNECT   │───→│   PURCHASE  │
│             │    │             │    │             │    │             │
│ Explorer    │    │ View reviews│    │ Message     │    │ 1-click buy │
│ See badges  │    │ Check online│    │ Ask Q&A     │    │ or negotiate│
│ on proxies  │    │ status      │    │ Get reply   │    │             │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                                             │
                                                             ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   FOLLOW    │←───│   REVIEW    │←───│    USE      │←───│   RECEIVE   │
│  PROVIDER   │    │             │    │             │    │  PROXY INFO │
│             │    │ Prompted on │    │ Track in    │    │             │
│ See future  │    │ completion  │    │ dashboard   │    │ Auto-setup  │
│ listings    │    │ Auto-award  │    │ Contact     │    │             │
└─────────────┘    │ badges      │    │ support     │    └─────────────┘
                   └─────────────┘    └─────────────┘
```

### 5.2 Provider Journey (with Social)

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   SETUP     │───→│    SHARE    │───→│   ENGAGE    │───→│    SELL     │
│             │    │             │    │             │    │             │
│ Add node    │    │ Auto-post   │    │ Get inquiries│   │ Close deals │
│ Configure   │    │ to feed     │    │ Answer Q&A  │    │ Get reviews │
│ Test        │    │ Announce to │    │ Chat with   │    │ Earn badges │
│             │    │ circles     │    │ buyers      │    │             │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                                             │
                                                             ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   SCALE     │←───│   BUILD     │←───│   DELIVER   │←───│   MANAGE    │
│             │    │  REPUTATION │    │             │    │   ORDERS    │
│ Join/Create │    │             │    │ Maintain    │    │             │
│ circles for │    │ 5★ reviews  │    │ uptime      │    │ Track usage │
│ pooling     │    │ → badges    │    │ Respond fast│    │ Extend/renew│
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

---

## Part 6: Success Metrics

### 6.1 Engagement Metrics

| Metric | Current | Target (3mo) | Target (6mo) |
|--------|---------|--------------|--------------|
| Messages sent/day | 0 | 50 | 200 |
| Reviews submitted/week | 0 | 20 | 100 |
| Listings with Q&A | 0% | 30% | 70% |
| Providers followed | 0 | 100 | 500 |
| Feed posts/day | 0 | 10 | 50 |
| Avg response time | N/A | <1hr | <15min |

### 6.2 Business Metrics

| Metric | Target Impact |
|--------|---------------|
| Conversion rate | +15% (social proof on listings) |
| Time to purchase | -20% (direct messaging reduces hesitation) |
| Provider retention | +25% (circles create stickiness) |
| Support tickets | -30% (Q&A reduces repeat questions) |
| LTV (buyer) | +40% (following = repeat purchases) |

---

## Part 7: Implementation Priority

### Phase 1: Foundation (Weeks 1-2)
- [ ] Add social columns to listings table
- [ ] Create `listing_inquiries` table
- [ ] Build `ProviderPresence` component
- [ ] Add online status tracking

### Phase 2: Explorer Integration (Weeks 3-4)
- [ ] Enhance ProxyCard with social bar
- [ ] Build ProxyDetail social sidebar
- [ ] Implement QuickMessageModal
- [ ] Add listing inquiry API

### Phase 3: Provider Dashboard (Weeks 5-6)
- [ ] Build ActivityFeedWidget
- [ ] Add node share flow
- [ ] Implement social share templates
- [ ] Create provider presence management

### Phase 4: Marketplace Flows (Weeks 7-8)
- [ ] Build Listing Q&A system
- [ ] Implement review prompt modal
- [ ] Add order timeline with messaging
- [ ] Create post-order engagement flow

### Phase 5: Advanced Features (Weeks 9-12)
- [ ] Circle pooling UI
- [ ] Enterprise quote flow
- [ ] Advanced analytics
- [ ] Mobile app integration

---

## Summary

Your vision of a **"seamlessly merged"** social system is exactly what's needed. The key principles:

1. **Context First** - Social features appear where they're relevant (proxy card → message button)
2. **Reduce Friction** - 1-click actions instead of navigation
3. **Build Trust** - Reviews, badges, presence visible everywhere
4. **Create Loops** - Each action creates social value (share node → feed → discovery)
5. **Empower Providers** - Tools to build reputation and community

The social system shouldn't be a destination—**it should be the connective tissue** that makes proxy discovery, provisioning, and trading feel like a seamless community experience.

---

*Strategy document for ProxyHubb Social System Integration*
