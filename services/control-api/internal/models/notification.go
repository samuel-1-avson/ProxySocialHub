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
	NotificationNewOrder        NotificationType = "new_order"
	NotificationOrderComplete   NotificationType = "order_complete"
	NotificationPaymentReceived NotificationType = "payment_received"
	NotificationPaymentSent     NotificationType = "payment_sent"
	NotificationListingSold     NotificationType = "listing_sold"
	
	// PAYG notifications
	NotificationMilestone   NotificationType = "milestone"
	NotificationLowBalance  NotificationType = "low_balance"
	NotificationRefillOffer NotificationType = "refill_offer"

	// Community notifications
	NotificationReply           NotificationType = "reply"
	NotificationUpvote          NotificationType = "upvote"
	NotificationBadgeEarned     NotificationType = "badge_earned"
	NotificationThreadFeatured  NotificationType = "thread_featured"

	// System notifications
	NotificationSecurityAlert   NotificationType = "security_alert"
	NotificationMaintenance     NotificationType = "maintenance"
	NotificationVerification    NotificationType = "verification"
	NotificationTrustTierChange NotificationType = "trust_tier_change"
)

// Notification represents a user notification
type Notification struct {
	ID        uuid.UUID        `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
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
