# Social Features Implementation Specification

**Status**: Technical Specification  
**Priority**: P0 - Critical for Q2  
**Estimated Effort**: 6-8 weeks

---

## 1. Notification System (Weeks 1-2)

### 1.1 Database Schema

```sql
-- Notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT,
    
    -- Action metadata
    action_url TEXT,
    action_type VARCHAR(50),
    
    -- Related entities
    actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    target_type VARCHAR(50),
    target_id UUID,
    
    -- Status
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    
    -- Delivery tracking
    channels_delivered JSONB DEFAULT '[]',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    INDEX idx_notifications_user_id (user_id),
    INDEX idx_notifications_user_read (user_id, is_read),
    INDEX idx_notifications_created (created_at)
);

-- Notification preferences
CREATE TABLE notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Channel preferences by category
    social_in_app BOOLEAN DEFAULT TRUE,
    social_email BOOLEAN DEFAULT TRUE,
    social_push BOOLEAN DEFAULT FALSE,
    
    business_in_app BOOLEAN DEFAULT TRUE,
    business_email BOOLEAN DEFAULT TRUE,
    business_push BOOLEAN DEFAULT TRUE,
    
    community_in_app BOOLEAN DEFAULT TRUE,
    community_email BOOLEAN DEFAULT TRUE,
    community_push BOOLEAN DEFAULT FALSE,
    
    system_in_app BOOLEAN DEFAULT TRUE,
    system_email BOOLEAN DEFAULT TRUE,
    system_push BOOLEAN DEFAULT TRUE,
    
    -- Digest settings
    email_digest_frequency VARCHAR(20) DEFAULT 'immediate', -- immediate, hourly, daily
    digest_day VARCHAR(10) DEFAULT 'monday',
    digest_hour INT DEFAULT 9,
    
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notification queue for async processing
CREATE TABLE notification_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    notification_id UUID REFERENCES notifications(id),
    channel VARCHAR(20) NOT NULL, -- email, push, webhook
    status VARCHAR(20) DEFAULT 'pending', -- pending, sent, failed
    retry_count INT DEFAULT 0,
    scheduled_for TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    error TEXT,
    
    INDEX idx_queue_status_scheduled (status, scheduled_for)
);
```

### 1.2 Go Models

```go
// services/control-api/internal/models/notification.go

package models

import (
    "time"
    
    "github.com/google/uuid"
    "gorm.io/datatypes"
)

// NotificationType represents different types of notifications
type NotificationType string

const (
    // Social notifications
    NotificationNewFollower      NotificationType = "new_follower"
    NotificationNewFriendRequest NotificationType = "friend_request"
    NotificationFriendAccepted   NotificationType = "friend_accepted"
    NotificationMessage          NotificationType = "message"
    NotificationMention          NotificationType = "mention"
    
    // Business notifications
    NotificationNewOrder         NotificationType = "new_order"
    NotificationOrderComplete    NotificationType = "order_complete"
    NotificationPaymentReceived  NotificationType = "payment_received"
    NotificationPaymentSent      NotificationType = "payment_sent"
    NotificationListingSold      NotificationType = "listing_sold"
    
    // Community notifications
    NotificationReply            NotificationType = "reply"
    NotificationUpvote           NotificationType = "upvote"
    NotificationBadgeEarned      NotificationType = "badge_earned"
    NotificationThreadFeatured   NotificationType = "thread_featured"
    
    // System notifications
    NotificationSecurityAlert    NotificationType = "security_alert"
    NotificationMaintenance      NotificationType = "maintenance"
    NotificationVerification     NotificationType = "verification"
    NotificationTrustTierChange  NotificationType = "trust_tier_change"
)

// Notification represents a user notification
type Notification struct {
    ID        uuid.UUID        `gorm:"type:uuid;primary_key" json:"id"`
    UserID    uuid.UUID        `gorm:"type:uuid;not null;index" json:"user_id"`
    Type      NotificationType `gorm:"size:50;not null" json:"type"`
    Title     string           `gorm:"size:200;not null" json:"title"`
    Body      string           `json:"body,omitempty"`
    
    // Action metadata
    ActionURL  string `json:"action_url,omitempty"`
    ActionType string `gorm:"size:50" json:"action_type,omitempty"`
    
    // Related entities
    ActorID    *uuid.UUID `gorm:"type:uuid" json:"actor_id,omitempty"`
    TargetType string     `gorm:"size:50" json:"target_type,omitempty"`
    TargetID   *uuid.UUID `gorm:"type:uuid" json:"target_id,omitempty"`
    
    // Status
    IsRead    bool       `gorm:"default:false" json:"is_read"`
    ReadAt    *time.Time `json:"read_at,omitempty"`
    
    // Delivery tracking
    ChannelsDelivered datatypes.JSON `gorm:"type:jsonb;default:'[]'" json:"channels_delivered"`
    
    CreatedAt time.Time `json:"created_at"`
    
    // Relations
    Actor *User `gorm:"foreignKey:ActorID" json:"actor,omitempty"`
}

// TableName sets the table name
func (Notification) TableName() string {
    return "notifications"
}

// NotificationPreference represents user notification settings
type NotificationPreference struct {
    UserID uuid.UUID `gorm:"type:uuid;primary_key" json:"user_id"`
    
    // Channel preferences by category
    SocialInApp  bool `gorm:"default:true" json:"social_in_app"`
    SocialEmail  bool `gorm:"default:true" json:"social_email"`
    SocialPush   bool `gorm:"default:false" json:"social_push"`
    
    BusinessInApp bool `gorm:"default:true" json:"business_in_app"`
    BusinessEmail bool `gorm:"default:true" json:"business_email"`
    BusinessPush  bool `gorm:"default:true" json:"business_push"`
    
    CommunityInApp bool `gorm:"default:true" json:"community_in_app"`
    CommunityEmail bool `gorm:"default:true" json:"community_email"`
    CommunityPush  bool `gorm:"default:false" json:"community_push"`
    
    SystemInApp bool `gorm:"default:true" json:"system_in_app"`
    SystemEmail bool `gorm:"default:true" json:"system_email"`
    SystemPush  bool `gorm:"default:true" json:"system_push"`
    
    // Digest settings
    EmailDigestFrequency string `gorm:"size:20;default:'immediate'" json:"email_digest_frequency"`
    DigestDay            string `gorm:"size:10;default:'monday'" json:"digest_day"`
    DigestHour           int    `gorm:"default:9" json:"digest_hour"`
    
    UpdatedAt time.Time `json:"updated_at"`
}

// TableName sets the table name
func (NotificationPreference) TableName() string {
    return "notification_preferences"
}

// ShouldSendToChannel checks if notification should be sent to given channel
func (np *NotificationPreference) ShouldSendToChannel(notifType NotificationType, channel string) bool {
    var inApp, email, push bool
    
    switch notifType {
    case NotificationNewFollower, NotificationNewFriendRequest, 
         NotificationFriendAccepted, NotificationMention:
        inApp, email, push = np.SocialInApp, np.SocialEmail, np.SocialPush
    case NotificationNewOrder, NotificationOrderComplete, 
         NotificationPaymentReceived, NotificationPaymentSent:
        inApp, email, push = np.BusinessInApp, np.BusinessEmail, np.BusinessPush
    case NotificationReply, NotificationUpvote, NotificationBadgeEarned:
        inApp, email, push = np.CommunityInApp, np.CommunityEmail, np.CommunityPush
    default:
        inApp, email, push = np.SystemInApp, np.SystemEmail, np.SystemPush
    }
    
    switch channel {
    case "in_app":
        return inApp
    case "email":
        return email
    case "push":
        return push
    }
    return false
}
```

### 1.3 Notification Service

```go
// services/control-api/internal/services/notification_service.go

package services

import (
    "context"
    "encoding/json"
    "fmt"
    "time"
    
    "github.com/google/uuid"
    "gorm.io/gorm"
    
    "proxyhubb/services/control-api/internal/models"
    "proxyhubb/services/control-api/internal/websocket"
)

// NotificationService handles notification creation and delivery
type NotificationService struct {
    db     *gorm.DB
    wsHub  *websocket.Hub
    email  EmailService
    push   PushService
}

// NewNotificationService creates a new notification service
func NewNotificationService(db *gorm.DB, wsHub *websocket.Hub, email EmailService, push PushService) *NotificationService {
    return &NotificationService{
        db:    db,
        wsHub: wsHub,
        email: email,
        push:  push,
    }
}

// CreateNotification creates and dispatches a notification
func (s *NotificationService) CreateNotification(
    ctx context.Context,
    userID uuid.UUID,
    notifType models.NotificationType,
    title, body string,
    actorID *uuid.UUID,
    targetType string,
    targetID *uuid.UUID,
) (*models.Notification, error) {
    
    notification := &models.Notification{
        ID:         uuid.New(),
        UserID:     userID,
        Type:       notifType,
        Title:      title,
        Body:       body,
        ActorID:    actorID,
        TargetType: targetType,
        TargetID:   targetID,
        CreatedAt:  time.Now(),
    }
    
    // Generate action URL based on type
    notification.ActionURL = s.generateActionURL(notifType, targetType, targetID)
    notification.ActionType = s.getActionType(notifType)
    
    // Save to database
    if err := s.db.Create(notification).Error; err != nil {
        return nil, fmt.Errorf("failed to create notification: %w", err)
    }
    
    // Dispatch to channels
    go s.dispatchNotification(notification)
    
    return notification, nil
}

// dispatchNotification sends notification through appropriate channels
func (s *NotificationService) dispatchNotification(n *models.Notification) {
    // Get user preferences
    var prefs models.NotificationPreference
    if err := s.db.First(&prefs, "user_id = ?", n.UserID).Error; err != nil {
        // Use defaults if no preferences set
        prefs = models.NotificationPreference{
            SocialInApp: true, SocialEmail: true,
            BusinessInApp: true, BusinessEmail: true, BusinessPush: true,
            CommunityInApp: true, CommunityEmail: true,
            SystemInApp: true, SystemEmail: true, SystemPush: true,
        }
    }
    
    delivered := []string{}
    
    // WebSocket (in-app)
    if prefs.ShouldSendToChannel(n.Type, "in_app") {
        s.wsHub.BroadcastToUser(n.UserID.String(), "notification", n)
        delivered = append(delivered, "in_app")
    }
    
    // Email
    if prefs.ShouldSendToChannel(n.Type, "email") {
        if prefs.EmailDigestFrequency == "immediate" {
            s.email.SendNotification(n)
            delivered = append(delivered, "email")
        } else {
            // Queue for digest
            s.queueForDigest(n)
        }
    }
    
    // Push
    if prefs.ShouldSendToChannel(n.Type, "push") {
        s.push.Send(n)
        delivered = append(delivered, "push")
    }
    
    // Update delivered channels
    channelsJSON, _ := json.Marshal(delivered)
    s.db.Model(n).Update("channels_delivered", channelsJSON)
}

// GetUnreadCount returns unread notification count for user
func (s *NotificationService) GetUnreadCount(userID uuid.UUID) (int64, error) {
    var count int64
    err := s.db.Model(&models.Notification{}).
        Where("user_id = ? AND is_read = ?", userID, false).
        Count(&count).Error
    return count, err
}

// MarkAsRead marks notifications as read
func (s *NotificationService) MarkAsRead(userID uuid.UUID, notificationIDs []uuid.UUID) error {
    now := time.Now()
    return s.db.Model(&models.Notification{}).
        Where("user_id = ? AND id IN ?", userID, notificationIDs).
        Updates(map[string]interface{}{
            "is_read": true,
            "read_at": now,
        }).Error
}

// MarkAllAsRead marks all notifications as read for a user
func (s *NotificationService) MarkAllAsRead(userID uuid.UUID) error {
    now := time.Now()
    return s.db.Model(&models.Notification{}).
        Where("user_id = ? AND is_read = ?", userID, false).
        Updates(map[string]interface{}{
            "is_read": true,
            "read_at": now,
        }).Error
}

// Helper methods
func (s *NotificationService) generateActionURL(notifType models.NotificationType, targetType string, targetID *uuid.UUID) string {
    if targetID == nil {
        return ""
    }
    
    switch notifType {
    case models.NotificationMessage:
        return fmt.Sprintf("/messages/%s", targetID.String())
    case models.NotificationNewOrder, models.NotificationOrderComplete:
        return fmt.Sprintf("/orders/%s", targetID.String())
    case models.NotificationNewFollower, models.NotificationNewFriendRequest:
        return fmt.Sprintf("/users/%s", targetID.String())
    case models.NotificationReply:
        return fmt.Sprintf("/forum/threads/%s", targetID.String())
    default:
        return fmt.Sprintf("/%s/%s", targetType, targetID.String())
    }
}

func (s *NotificationService) getActionType(notifType models.NotificationType) string {
    switch notifType {
    case models.NotificationMessage:
        return "view_message"
    case models.NotificationNewOrder, models.NotificationOrderComplete:
        return "view_order"
    case models.NotificationNewFollower:
        return "view_profile"
    default:
        return "view"
    }
}

func (s *NotificationService) queueForDigest(n *models.Notification) {
    // Implementation for digest queuing
}
```

### 1.4 API Endpoints

```go
// services/control-api/internal/api/notifications.go

package api

import (
    "net/http"
    
    "github.com/gin-gonic/gin"
    "github.com/google/uuid"
    
    "proxyhubb/services/control-api/internal/auth"
    "proxyhubb/services/control-api/internal/db"
    "proxyhubb/services/control-api/internal/models"
)

// RegisterNotificationRoutes registers notification routes
func RegisterNotificationRoutes(rg *gin.RouterGroup) {
    n := rg.Group("/notifications")
    n.Use(auth.JWTAuth())
    {
        n.GET("", getNotifications)
        n.GET("/unread-count", getUnreadCount)
        n.POST("/:id/read", markNotificationRead)
        n.POST("/read-all", markAllRead)
        n.DELETE("/:id", deleteNotification)
    }
    
    // Preferences
    prefs := rg.Group("/notification-preferences")
    prefs.Use(auth.JWTAuth())
    {
        prefs.GET("", getPreferences)
        prefs.PUT("", updatePreferences)
    }
}

func getNotifications(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    
    var query struct {
        Page   int  `form:"page,default=1"`
        Limit  int  `form:"limit,default=20"`
        Unread bool `form:"unread"`
    }
    c.ShouldBindQuery(&query)
    
    dbQuery := db.DB.Where("user_id = ?", userID).
        Order("created_at DESC")
    
    if query.Unread {
        dbQuery = dbQuery.Where("is_read = ?", false)
    }
    
    var notifications []models.Notification
    var total int64
    
    dbQuery.Model(&models.Notification{}).Count(&total)
    dbQuery.Offset((query.Page - 1) * query.Limit).
        Limit(query.Limit).
        Preload("Actor").
        Find(&notifications)
    
    c.JSON(http.StatusOK, gin.H{
        "notifications": notifications,
        "total":         total,
        "page":          query.Page,
        "limit":         query.Limit,
    })
}

func getUnreadCount(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    
    var count int64
    db.DB.Model(&models.Notification{}).
        Where("user_id = ? AND is_read = ?", userID, false).
        Count(&count)
    
    c.JSON(http.StatusOK, gin.H{"count": count})
}

func markNotificationRead(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    notificationID, _ := uuid.Parse(c.Param("id"))
    
    db.DB.Model(&models.Notification{}).
        Where("id = ? AND user_id = ?", notificationID, userID).
        Update("is_read", true)
    
    c.JSON(http.StatusOK, gin.H{"message": "marked as read"})
}

func markAllRead(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    
    db.DB.Model(&models.Notification{}).
        Where("user_id = ? AND is_read = ?", userID, false).
        Update("is_read", true)
    
    c.JSON(http.StatusOK, gin.H{"message": "all notifications marked as read"})
}

func deleteNotification(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    notificationID, _ := uuid.Parse(c.Param("id"))
    
    db.DB.Where("id = ? AND user_id = ?", notificationID, userID).
        Delete(&models.Notification{})
    
    c.JSON(http.StatusOK, gin.H{"message": "notification deleted"})
}

func getPreferences(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    
    var prefs models.NotificationPreference
    if err := db.DB.First(&prefs, "user_id = ?", userID).Error; err != nil {
        // Return defaults
        prefs = models.NotificationPreference{
            UserID: userID,
        }
    }
    
    c.JSON(http.StatusOK, prefs)
}

func updatePreferences(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    
    var req models.NotificationPreference
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    
    req.UserID = userID
    
    if err := db.DB.Save(&req).Error; err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
    
    c.JSON(http.StatusOK, req)
}
```

---

## 2. Provider Showcase (Weeks 3-4)

### 2.1 Database Schema

```sql
-- Provider showcases (portfolio/portfolio items)
CREATE TABLE provider_showcases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    title VARCHAR(200) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL, -- 'speed_test', 'testimonial', 'metric', 'media'
    
    -- Media
    media_urls TEXT[], -- Array of image/video URLs
    thumbnail_url TEXT,
    
    -- Metrics data
    metrics JSONB DEFAULT '{}',
    
    -- Display order
    display_order INT DEFAULT 0,
    is_featured BOOLEAN DEFAULT FALSE,
    is_public BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    INDEX idx_showcases_provider (provider_id),
    INDEX idx_showcases_featured (is_featured)
);

-- Speed test results (automated)
CREATE TABLE speed_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Test results
    download_speed FLOAT, -- Mbps
    upload_speed FLOAT,   -- Mbps
    latency_ms INT,
    jitter_ms INT,
    packet_loss_percent FLOAT,
    
    -- Location
    server_location VARCHAR(100),
    proxy_location VARCHAR(100),
    
    -- Metadata
    test_type VARCHAR(50), -- 'automated', 'manual', 'customer'
    test_method VARCHAR(50), -- 'speedtest', 'fast', 'custom'
    
    is_public BOOLEAN DEFAULT TRUE,
    tested_at TIMESTAMPTZ DEFAULT NOW(),
    
    INDEX idx_speed_tests_provider (provider_id, tested_at)
);

-- Testimonials from customers
CREATE TABLE testimonials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    
    content TEXT NOT NULL,
    rating INT CHECK (rating >= 1 AND rating <= 5),
    
    -- Verification
    is_verified BOOLEAN DEFAULT FALSE, -- Verified purchase
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    
    -- Display
    is_approved BOOLEAN DEFAULT FALSE,
    is_featured BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    INDEX idx_testimonials_provider (provider_id, is_approved, is_featured)
);

-- Provider statistics (cached aggregates)
CREATE TABLE provider_stats (
    provider_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Performance
    avg_download_speed FLOAT,
    avg_upload_speed FLOAT,
    avg_latency_ms INT,
    uptime_percent FLOAT,
    
    -- Business
    total_sessions INT DEFAULT 0,
    total_bandwidth_tb FLOAT DEFAULT 0,
    active_customers INT DEFAULT 0,
    
    -- Ratings
    avg_rating FLOAT DEFAULT 0,
    total_reviews INT DEFAULT 0,
    
    -- Calculated
    last_calculated_at TIMESTAMPTZ,
    
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.2 Go Models

```go
// services/control-api/internal/models/showcase.go

package models

import (
    "time"
    
    "github.com/google/uuid"
    "gorm.io/datatypes"
)

// ShowcaseType represents the type of showcase item
type ShowcaseType string

const (
    ShowcaseTypeSpeedTest   ShowcaseType = "speed_test"
    ShowcaseTypeTestimonial ShowcaseType = "testimonial"
    ShowcaseTypeMetric      ShowcaseType = "metric"
    ShowcaseTypeMedia       ShowcaseType = "media"
    ShowcaseTypeNetwork     ShowcaseType = "network"
)

// ProviderShowcase represents a portfolio item for providers
type ProviderShowcase struct {
    ID          uuid.UUID    `gorm:"type:uuid;primary_key" json:"id"`
    ProviderID  uuid.UUID    `gorm:"type:uuid;not null;index" json:"provider_id"`
    
    Title       string       `gorm:"size:200;not null" json:"title"`
    Description string       `json:"description,omitempty"`
    Type        ShowcaseType `gorm:"size:50;not null" json:"type"`
    
    // Media
    MediaURLs    []string `gorm:"type:text[]" json:"media_urls,omitempty"`
    ThumbnailURL string   `json:"thumbnail_url,omitempty"`
    
    // Metrics
    Metrics datatypes.JSON `gorm:"type:jsonb;default:'{}'" json:"metrics,omitempty"`
    
    // Display
    DisplayOrder int  `gorm:"default:0" json:"display_order"`
    IsFeatured   bool `gorm:"default:false" json:"is_featured"`
    IsPublic     bool `gorm:"default:true" json:"is_public"`
    
    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at"`
    
    // Relations
    Provider *User `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
}

// TableName sets the table name
func (ProviderShowcase) TableName() string {
    return "provider_showcases"
}

// SpeedTest represents an automated speed test result
type SpeedTest struct {
    ID           uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
    ProviderID   uuid.UUID `gorm:"type:uuid;not null;index" json:"provider_id"`
    
    // Results
    DownloadSpeed      float64 `json:"download_speed"`      // Mbps
    UploadSpeed        float64 `json:"upload_speed"`        // Mbps
    LatencyMs          int     `json:"latency_ms"`
    JitterMs           int     `json:"jitter_ms"`
    PacketLossPercent  float64 `json:"packet_loss_percent"`
    
    // Location
    ServerLocation string `json:"server_location,omitempty"`
    ProxyLocation  string `json:"proxy_location,omitempty"`
    
    // Metadata
    TestType   string `gorm:"size:50" json:"test_type"`
    TestMethod string `gorm:"size:50" json:"test_method"`
    
    IsPublic  bool      `gorm:"default:true" json:"is_public"`
    TestedAt  time.Time `json:"tested_at"`
    
    // Relations
    Provider *User `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
}

// TableName sets the table name
func (SpeedTest) TableName() string {
    return "speed_tests"
}

// Testimonial represents a customer testimonial
type Testimonial struct {
    ID         uuid.UUID  `gorm:"type:uuid;primary_key" json:"id"`
    ProviderID uuid.UUID  `gorm:"type:uuid;not null;index" json:"provider_id"`
    CustomerID *uuid.UUID `gorm:"type:uuid" json:"customer_id,omitempty"`
    
    Content string `json:"content"`
    Rating  int    `json:"rating"`
    
    // Verification
    IsVerified bool       `gorm:"default:false" json:"is_verified"`
    OrderID    *uuid.UUID `gorm:"type:uuid" json:"order_id,omitempty"`
    
    // Display
    IsApproved bool `gorm:"default:false" json:"is_approved"`
    IsFeatured bool `gorm:"default:false" json:"is_featured"`
    
    CreatedAt time.Time `json:"created_at"`
    
    // Relations
    Provider *User `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
    Customer *User `gorm:"foreignKey:CustomerID" json:"customer,omitempty"`
}

// TableName sets the table name
func (Testimonial) TableName() string {
    return "testimonials"
}

// ProviderStats represents cached provider statistics
type ProviderStats struct {
    ProviderID uuid.UUID `gorm:"type:uuid;primary_key" json:"provider_id"`
    
    // Performance
    AvgDownloadSpeed float64 `json:"avg_download_speed"`
    AvgUploadSpeed   float64 `json:"avg_upload_speed"`
    AvgLatencyMs     int     `json:"avg_latency_ms"`
    UptimePercent    float64 `json:"uptime_percent"`
    
    // Business
    TotalSessions   int     `json:"total_sessions"`
    TotalBandwidthTb float64 `json:"total_bandwidth_tb"`
    ActiveCustomers  int     `json:"active_customers"`
    
    // Ratings
    AvgRating    float64 `json:"avg_rating"`
    TotalReviews int     `json:"total_reviews"`
    
    // Metadata
    LastCalculatedAt *time.Time `json:"last_calculated_at"`
    UpdatedAt        time.Time  `json:"updated_at"`
    
    // Relations
    Provider *User `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
}

// TableName sets the table name
func (ProviderStats) TableName() string {
    return "provider_stats"
}
```

### 2.3 API Endpoints

```go
// services/control-api/internal/api/showcase.go

package api

import (
    "net/http"
    
    "github.com/gin-gonic/gin"
    "github.com/google/uuid"
    
    "proxyhubb/services/control-api/internal/auth"
    "proxyhubb/services/control-api/internal/db"
    "proxyhubb/services/control-api/internal/models"
)

// RegisterShowcaseRoutes registers showcase routes
func RegisterShowcaseRoutes(rg *gin.RouterGroup) {
    // Public routes
    s := rg.Group("/showcases")
    {
        s.GET("/providers/:providerId", getProviderShowcases)
        s.GET("/providers/:providerId/stats", getProviderStats)
        s.GET("/providers/:providerId/testimonials", getProviderTestimonials)
        s.GET("/providers/:providerId/speed-tests", getProviderSpeedTests)
    }
    
    // Provider-only routes
    provider := rg.Group("/provider/showcase")
    provider.Use(auth.JWTAuth(), auth.RequireRole("provider"))
    {
        provider.POST("", createShowcase)
        provider.PUT("/:id", updateShowcase)
        provider.DELETE("/:id", deleteShowcase)
        provider.POST("/reorder", reorderShowcases)
    }
    
    // Testimonials
    testimonials := rg.Group("/testimonials")
    testimonials.Use(auth.JWTAuth())
    {
        testimonials.POST("", submitTestimonial)
        testimonials.DELETE("/:id", deleteTestimonial)
    }
}

// Public handlers
func getProviderShowcases(c *gin.Context) {
    providerID, _ := uuid.Parse(c.Param("providerId"))
    
    var showcases []models.ProviderShowcase
    db.DB.Where("provider_id = ? AND is_public = ?", providerID, true).
        Order("display_order ASC, created_at DESC").
        Find(&showcases)
    
    c.JSON(http.StatusOK, gin.H{"showcases": showcases})
}

func getProviderStats(c *gin.Context) {
    providerID, _ := uuid.Parse(c.Param("providerId"))
    
    var stats models.ProviderStats
    if err := db.DB.First(&stats, "provider_id = ?", providerID).Error; err != nil {
        c.JSON(http.StatusOK, gin.H{"stats": nil})
        return
    }
    
    c.JSON(http.StatusOK, gin.H{"stats": stats})
}

func getProviderTestimonials(c *gin.Context) {
    providerID, _ := uuid.Parse(c.Param("providerId"))
    
    var testimonials []models.Testimonial
    db.DB.Where("provider_id = ? AND is_approved = ?", providerID, true).
        Order("is_featured DESC, created_at DESC").
        Preload("Customer").
        Find(&testimonials)
    
    c.JSON(http.StatusOK, gin.H{"testimonials": testimonials})
}

func getProviderSpeedTests(c *gin.Context) {
    providerID, _ := uuid.Parse(c.Param("providerId"))
    
    var tests []models.SpeedTest
    db.DB.Where("provider_id = ? AND is_public = ?", providerID, true).
        Order("tested_at DESC").
        Limit(30).
        Find(&tests)
    
    c.JSON(http.StatusOK, gin.H{"speed_tests": tests})
}

// Provider handlers
func createShowcase(c *gin.Context) {
    providerID, _ := auth.GetUserID(c)
    
    var req struct {
        Title       string                 `json:"title" binding:"required"`
        Description string                 `json:"description"`
        Type        models.ShowcaseType    `json:"type" binding:"required"`
        MediaURLs   []string               `json:"media_urls"`
        Metrics     map[string]interface{} `json:"metrics"`
        IsFeatured  bool                   `json:"is_featured"`
    }
    
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    
    showcase := &models.ProviderShowcase{
        ProviderID:  providerID,
        Title:       req.Title,
        Description: req.Description,
        Type:        req.Type,
        MediaURLs:   req.MediaURLs,
        IsFeatured:  req.IsFeatured,
    }
    
    if err := db.DB.Create(showcase).Error; err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
    
    c.JSON(http.StatusCreated, showcase)
}

func updateShowcase(c *gin.Context) {
    // Implementation
}

func deleteShowcase(c *gin.Context) {
    // Implementation
}

func reorderShowcases(c *gin.Context) {
    // Implementation
}

// Testimonial handlers
func submitTestimonial(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    
    var req struct {
        ProviderID uuid.UUID `json:"provider_id" binding:"required"`
        Content    string    `json:"content" binding:"required,min=10,max=1000"`
        Rating     int       `json:"rating" binding:"required,min=1,max=5"`
        OrderID    *uuid.UUID `json:"order_id"`
    }
    
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    
    testimonial := &models.Testimonial{
        ProviderID: req.ProviderID,
        CustomerID: &userID,
        Content:    req.Content,
        Rating:     req.Rating,
        OrderID:    req.OrderID,
        IsVerified: req.OrderID != nil,
    }
    
    if err := db.DB.Create(testimonial).Error; err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
    
    c.JSON(http.StatusCreated, testimonial)
}

func deleteTestimonial(c *gin.Context) {
    // Implementation
}
```

---

## 3. Enhanced Messaging (Weeks 5-6)

### 3.1 Database Schema Updates

```sql
-- Add to existing messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- Message attachments
CREATE TABLE message_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    
    type VARCHAR(50) NOT NULL, -- 'image', 'document', 'contract'
    url TEXT NOT NULL,
    file_name VARCHAR(255),
    file_size BIGINT,
    mime_type VARCHAR(100),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    INDEX idx_attachments_message (message_id)
);

-- Message reactions
CREATE TABLE message_reactions (
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    emoji VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    PRIMARY KEY (message_id, user_id, emoji)
);
```

### 3.2 Enhanced Models

```go
// services/control-api/internal/models/messaging_enhanced.go

package models

import (
    "time"
    
    "github.com/google/uuid"
)

// MessageType represents the type of message
type MessageType string

const (
    MessageTypeText    MessageType = "text"
    MessageTypeImage   MessageType = "image"
    MessageTypeFile    MessageType = "file"
    MessageTypeSystem  MessageType = "system"
    MessageTypeOrder   MessageType = "order"
)

// Enhanced Message model (extends existing)
type MessageEnhanced struct {
    Message
    
    // New fields
    Type        MessageType          `gorm:"size:20;default:'text'" json:"type"`
    ReplyToID   *uuid.UUID           `gorm:"type:uuid" json:"reply_to_id,omitempty"`
    EditedAt    *time.Time           `json:"edited_at,omitempty"`
    IsDeleted   bool                 `gorm:"default:false" json:"is_deleted"`
    
    // Relations
    ReplyTo      *Message              `gorm:"foreignKey:ReplyToID" json:"reply_to,omitempty"`
    Attachments  []MessageAttachment   `gorm:"foreignKey:MessageID" json:"attachments,omitempty"`
    Reactions    []MessageReactionView `gorm:"-" json:"reactions,omitempty"`
}

// MessageAttachment represents a file attachment
type MessageAttachment struct {
    ID        uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
    MessageID uuid.UUID `gorm:"type:uuid;not null;index" json:"message_id"`
    
    Type     string `gorm:"size:50;not null" json:"type"`
    URL      string `json:"url"`
    FileName string `gorm:"size:255" json:"file_name,omitempty"`
    FileSize int64  `json:"file_size,omitempty"`
    MimeType string `gorm:"size:100" json:"mime_type,omitempty"`
    
    CreatedAt time.Time `json:"created_at"`
}

// TableName sets the table name
func (MessageAttachment) TableName() string {
    return "message_attachments"
}

// MessageReaction represents a reaction to a message
type MessageReaction struct {
    MessageID uuid.UUID `gorm:"type:uuid;primary_key" json:"message_id"`
    UserID    uuid.UUID `gorm:"type:uuid;primary_key" json:"user_id"`
    Emoji     string    `gorm:"size:10;primary_key" json:"emoji"`
    CreatedAt time.Time `json:"created_at"`
}

// TableName sets the table name
func (MessageReaction) TableName() string {
    return "message_reactions"
}

// MessageReactionView for aggregated display
type MessageReactionView struct {
    Emoji     string    `json:"emoji"`
    Count     int       `json:"count"`
    UserIDs   []string  `json:"user_ids,omitempty"`
    HasReacted bool     `json:"has_reacted"`
}
```

### 3.3 API Endpoints

```go
// services/control-api/internal/api/messaging_enhanced.go

package api

import (
    "net/http"
    
    "github.com/gin-gonic/gin"
    "github.com/google/uuid"
    
    "proxyhubb/services/control-api/internal/auth"
    "proxyhubb/services/control-api/internal/db"
    "proxyhubb/services/control-api/internal/models"
)

// RegisterEnhancedMessagingRoutes adds enhanced messaging endpoints
func RegisterEnhancedMessagingRoutes(rg *gin.RouterGroup) {
    messages := rg.Group("/conversations/:id/messages")
    messages.Use(auth.JWTAuth())
    {
        // Existing endpoints...
        
        // New endpoints
        messages.PUT("/:messageId", editMessage)
        messages.DELETE("/:messageId", deleteMessage)
        messages.POST("/:messageId/reactions", addReaction)
        messages.DELETE("/:messageId/reactions/:emoji", removeReaction)
    }
    
    // File upload
    rg.POST("/conversations/:id/attachments", auth.JWTAuth(), uploadAttachment)
    
    // Message search
    rg.GET("/conversations/:id/search", auth.JWTAuth(), searchMessages)
}

func editMessage(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    convID, _ := uuid.Parse(c.Param("id"))
    msgID, _ := uuid.Parse(c.Param("messageId"))
    
    var req struct {
        Content string `json:"content" binding:"required,min=1,max=2000"`
    }
    
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    
    // Verify user owns the message and it's recent (< 5 min)
    var msg models.Message
    if err := db.DB.First(&msg, "id = ? AND conversation_id = ?", msgID, convID).Error; err != nil {
        c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
        return
    }
    
    if msg.SenderID != userID {
        c.JSON(http.StatusForbidden, gin.H{"error": "cannot edit others' messages"})
        return
    }
    
    if time.Since(msg.CreatedAt) > 5*time.Minute {
        c.JSON(http.StatusForbidden, gin.H{"error": "edit window expired"})
        return
    }
    
    now := time.Now()
    db.DB.Model(&msg).Updates(map[string]interface{}{
        "content":   req.Content,
        "edited_at": now,
    })
    
    c.JSON(http.StatusOK, msg)
}

func deleteMessage(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    convID, _ := uuid.Parse(c.Param("id"))
    msgID, _ := uuid.Parse(c.Param("messageId"))
    
    var msg models.Message
    if err := db.DB.First(&msg, "id = ? AND conversation_id = ?", msgID, convID).Error; err != nil {
        c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
        return
    }
    
    // Only sender or conversation participants can delete
    if msg.SenderID != userID {
        // Check if user is a participant
        var conv models.Conversation
        db.DB.First(&conv, "id = ?", convID)
        if conv.Participant1 != userID && conv.Participant2 != userID {
            c.JSON(http.StatusForbidden, gin.H{"error": "not authorized"})
            return
        }
    }
    
    db.DB.Model(&msg).Update("is_deleted", true)
    
    c.JSON(http.StatusOK, gin.H{"message": "message deleted"})
}

func addReaction(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    convID, _ := uuid.Parse(c.Param("id"))
    msgID, _ := uuid.Parse(c.Param("messageId"))
    
    var req struct {
        Emoji string `json:"emoji" binding:"required"`
    }
    
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    
    // Verify message exists in conversation
    var msg models.Message
    if err := db.DB.First(&msg, "id = ? AND conversation_id = ?", msgID, convID).Error; err != nil {
        c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
        return
    }
    
    reaction := &models.MessageReaction{
        MessageID: msgID,
        UserID:    userID,
        Emoji:     req.Emoji,
        CreatedAt: time.Now(),
    }
    
    // Upsert reaction
    db.DB.Save(reaction)
    
    c.JSON(http.StatusCreated, reaction)
}

func removeReaction(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    msgID, _ := uuid.Parse(c.Param("messageId"))
    emoji := c.Param("emoji")
    
    db.DB.Where("message_id = ? AND user_id = ? AND emoji = ?", msgID, userID, emoji).
        Delete(&models.MessageReaction{})
    
    c.JSON(http.StatusOK, gin.H{"message": "reaction removed"})
}

func uploadAttachment(c *gin.Context) {
    // Implementation using file upload service
}

func searchMessages(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    convID, _ := uuid.Parse(c.Param("id"))
    query := c.Query("q")
    
    if query == "" {
        c.JSON(http.StatusBadRequest, gin.H{"error": "query required"})
        return
    }
    
    // Verify user is participant
    var conv models.Conversation
    if err := db.DB.First(&conv, "id = ?", convID).Error; err != nil {
        c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
        return
    }
    
    if conv.Participant1 != userID && conv.Participant2 != userID {
        c.JSON(http.StatusForbidden, gin.H{"error": "not authorized"})
        return
    }
    
    var messages []models.Message
    db.DB.Where("conversation_id = ? AND content ILIKE ? AND is_deleted = ?", 
        convID, "%"+query+"%", false).
        Order("created_at DESC").
        Limit(50).
        Preload("Sender").
        Find(&messages)
    
    c.JSON(http.StatusOK, gin.H{"messages": messages, "query": query})
}
```

---

## 4. Social Discovery (Weeks 7-8)

### 4.1 People You May Know Algorithm

```go
// services/control-api/internal/services/discovery_service.go

package services

import (
    "context"
    "math"
    
    "github.com/google/uuid"
    "gorm.io/gorm"
    
    "proxyhubb/services/control-api/internal/db"
    "proxyhubb/services/control-api/internal/models"
)

// DiscoveryService handles social discovery features
type DiscoveryService struct {
    db *gorm.DB
}

// SuggestedUser represents a user recommendation
type SuggestedUser struct {
    models.User
    Reason      string  `json:"reason"`
    Score       float64 `json:"score"`
    MutualCount int     `json:"mutual_count,omitempty"`
}

// GetPeopleYouMayKnow returns suggested connections
func (s *DiscoveryService) GetPeopleYouMayKnow(userID uuid.UUID, limit int) ([]SuggestedUser, error) {
    suggestions := []SuggestedUser{}
    
    // 1. Mutual friends (highest weight)
    mutualQuery := `
        SELECT u.*, COUNT(DISTINCT m.friend_id) as mutual_count
        FROM profiles u
        JOIN friendships f1 ON f1.user_id = ?
        JOIN friendships f2 ON f2.user_id = f1.friend_id AND f2.friend_id != ?
        JOIN friendships m ON m.user_id = ? AND m.friend_id = f2.friend_id
        WHERE u.id = f2.friend_id
        AND u.id NOT IN (SELECT friend_id FROM friendships WHERE user_id = ?)
        AND u.id NOT IN (SELECT receiver_id FROM friend_requests WHERE sender_id = ? AND status = 'pending')
        GROUP BY u.id
        ORDER BY mutual_count DESC
        LIMIT ?
    `
    
    var mutualFriends []struct {
        models.User
        MutualCount int
    }
    db.DB.Raw(mutualQuery, userID, userID, userID, userID, userID, limit/2).Scan(&mutualFriends)
    
    for _, u := range mutualFriends {
        suggestions = append(suggestions, SuggestedUser{
            User:        u.User,
            Reason:      "mutual_friends",
            Score:       1.0 + float64(u.MutualCount)*0.1,
            MutualCount: u.MutualCount,
        })
    }
    
    // 2. Similar skills/interests
    skillsQuery := `
        SELECT u.*, COUNT(DISTINCT s.skill) as common_skills
        FROM profiles u
        JOIN LATERAL unnest(u.skills) as s(skill) ON s.skill = ANY(
            SELECT skill FROM unnest((SELECT skills FROM profiles WHERE id = ?)) as skill
        )
        WHERE u.id != ?
        AND u.id NOT IN (SELECT friend_id FROM friendships WHERE user_id = ?)
        AND u.role = 'provider'
        GROUP BY u.id
        ORDER BY common_skills DESC, u.avg_rating DESC
        LIMIT ?
    `
    
    var similarUsers []struct {
        models.User
        CommonSkills int
    }
    db.DB.Raw(skillsQuery, userID, userID, userID, limit/3).Scan(&similarUsers)
    
    for _, u := range similarUsers {
        // Check if already in suggestions
        exists := false
        for _, s := range suggestions {
            if s.ID == u.ID {
                exists = true
                break
            }
        }
        if !exists {
            suggestions = append(suggestions, SuggestedUser{
                User:   u.User,
                Reason: "similar_skills",
                Score:  0.7 + float64(u.CommonSkills)*0.1,
            })
        }
    }
    
    // 3. Same region/location
    // 4. Recently active providers
    // 5. Trending in your network
    
    // Sort by score and limit
    sort.Slice(suggestions, func(i, j int) bool {
        return suggestions[i].Score > suggestions[j].Score
    })
    
    if len(suggestions) > limit {
        suggestions = suggestions[:limit]
    }
    
    return suggestions, nil
}

// GetTrendingProviders returns trending providers
func (s *DiscoveryService) GetTrendingProviders(userID uuid.UUID, limit int) ([]models.User, error) {
    var providers []models.User
    
    // Score = recent_sales * 0.4 + rating * 0.3 + activity * 0.3
    query := `
        SELECT u.*,
               COALESCE(ps.total_sessions, 0) as score
        FROM profiles u
        LEFT JOIN provider_stats ps ON ps.provider_id = u.id
        WHERE u.role = 'provider'
        AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
        AND u.verified = true
        ORDER BY 
            u.avg_rating DESC,
            COALESCE(ps.total_sessions, 0) DESC,
            u.created_at DESC
        LIMIT ?
    `
    
    db.DB.Raw(query, userID, limit).Scan(&providers)
    
    return providers, nil
}

// GetRecommendedCommunities returns community recommendations
func (s *DiscoveryService) GetRecommendedCommunities(userID uuid.UUID, limit int) ([]models.Community, error) {
    // Based on user interests, followed users' memberships, trending
    var communities []models.Community
    
    query := `
        SELECT c.*
        FROM communities c
        WHERE c.type = 'public'
        AND c.id NOT IN (
            SELECT community_id FROM community_memberships WHERE user_id = ?
        )
        ORDER BY c.member_count DESC, c.post_count DESC
        LIMIT ?
    `
    
    db.DB.Raw(query, userID, limit).Scan(&communities)
    
    return communities, nil
}
```

### 4.2 Discovery API

```go
// services/control-api/internal/api/discovery.go

package api

import (
    "net/http"
    
    "github.com/gin-gonic/gin"
    
    "proxyhubb/services/control-api/internal/auth"
    "proxyhubb/services/control-api/internal/services"
)

// RegisterDiscoveryRoutes registers discovery routes
func RegisterDiscoveryRoutes(rg *gin.RouterGroup, discoveryService *services.DiscoveryService) {
    d := rg.Group("/discover")
    d.Use(auth.JWTAuth())
    {
        d.GET("/people", getPeopleYouMayKnow)
        d.GET("/providers", getTrendingProviders)
        d.GET("/communities", getRecommendedCommunities)
    }
}

func getPeopleYouMayKnow(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    
    var query struct {
        Limit int `form:"limit,default=10"`
    }
    c.ShouldBindQuery(&query)
    
    service := services.NewDiscoveryService(db.DB)
    suggestions, err := service.GetPeopleYouMayKnow(userID, query.Limit)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
    
    c.JSON(http.StatusOK, gin.H{
        "suggestions": suggestions,
        "count":       len(suggestions),
    })
}

func getTrendingProviders(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    
    var query struct {
        Limit  int    `form:"limit,default=10"`
        Region string `form:"region"`
    }
    c.ShouldBindQuery(&query)
    
    service := services.NewDiscoveryService(db.DB)
    providers, err := service.GetTrendingProviders(userID, query.Limit)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
    
    c.JSON(http.StatusOK, gin.H{
        "providers": providers,
        "count":     len(providers),
    })
}

func getRecommendedCommunities(c *gin.Context) {
    userID, _ := auth.GetUserID(c)
    
    var query struct {
        Limit int `form:"limit,default=10"`
    }
    c.ShouldBindQuery(&query)
    
    service := services.NewDiscoveryService(db.DB)
    communities, err := service.GetRecommendedCommunities(userID, query.Limit)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
    
    c.JSON(http.StatusOK, gin.H{
        "communities": communities,
        "count":       len(communities),
    })
}
```

---

## Testing Strategy

### Unit Tests

```go
// services/control-api/internal/services/notification_service_test.go

package services

import (
    "testing"
    
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/mock"
)

func TestNotificationService_CreateNotification(t *testing.T) {
    // Test implementation
}

func TestNotificationService_ShouldSendToChannel(t *testing.T) {
    prefs := &models.NotificationPreference{
        SocialInApp:   true,
        SocialEmail:   true,
        BusinessInApp: true,
        BusinessEmail: false,
    }
    
    assert.True(t, prefs.ShouldSendToChannel(models.NotificationNewFollower, "in_app"))
    assert.True(t, prefs.ShouldSendToChannel(models.NotificationNewFollower, "email"))
    assert.False(t, prefs.ShouldSendToChannel(models.NotificationNewOrder, "email"))
}
```

### Integration Tests

```bash
# Notification flow
curl -X POST http://localhost:8080/v1/follows/$userId \
  -H "Authorization: Bearer $token"

# Verify notification created
curl http://localhost:8080/v1/notifications/unread-count \
  -H "Authorization: Bearer $target_token"
```

---

## Migration Script

```sql
-- migrations/20260309_social_features.sql

-- Run as part of deployment

-- Notifications
\i notifications_schema.sql

-- Showcases
\i showcase_schema.sql

-- Enhanced messaging
\i messaging_enhanced_schema.sql

-- Backfill provider stats
INSERT INTO provider_stats (provider_id)
SELECT id FROM profiles WHERE role = 'provider'
ON CONFLICT DO NOTHING;
```

---

## Deployment Checklist

- [ ] Database migrations applied
- [ ] New environment variables configured
- [ ] Email service configured
- [ ] Push notification service configured (optional)
- [ ] CDN configured for media uploads
- [ ] WebSocket server updated
- [ ] API documentation updated
- [ ] Frontend components ready
- [ ] Analytics events added

---

**Document Version**: 1.0  
**Last Updated**: March 9, 2026  
**Status**: Ready for Implementation
