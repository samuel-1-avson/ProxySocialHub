package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// FeedEventType represents the type of feed event
type FeedEventType string

const (
	FeedEventNewListing     FeedEventType = "new_listing"
	FeedEventListingUpdate  FeedEventType = "listing_update"
	FeedEventNewReview      FeedEventType = "new_review"
	FeedEventBadgeEarned    FeedEventType = "badge_earned"
	FeedEventCircleAnnounce FeedEventType = "circle_announcement"
	FeedEventNodeOnline     FeedEventType = "node_online"
	FeedEventMilestone      FeedEventType = "milestone"
	FeedEventNewFollower    FeedEventType = "new_follower"
	FeedEventNewSale        FeedEventType = "new_sale"
	FeedEventNewThread      FeedEventType = "new_thread"
)

// FeedEvent represents an event in the activity feed
type FeedEvent struct {
	ID         uuid.UUID      `gorm:"type:uuid;primary_key" json:"id"`
	ActorID    *uuid.UUID     `gorm:"type:uuid" json:"actor_id,omitempty"`
	EventType  FeedEventType  `gorm:"size:50;not null" json:"event_type"`
	TargetType string         `gorm:"size:50" json:"target_type,omitempty"` // "listing", "user", "circle", "review"
	TargetID   *uuid.UUID     `gorm:"type:uuid" json:"target_id,omitempty"`
	Content    string         `json:"content"`
	Metadata   datatypes.JSON `gorm:"type:jsonb;default:'{}'" json:"metadata"`
	CreatedAt  time.Time      `json:"created_at"`

	// Preloaded relations
	Actor *User `gorm:"foreignKey:ActorID" json:"actor,omitempty"`
}

// TableName sets the table name for FeedEvent
func (FeedEvent) TableName() string {
	return "feed_events"
}

// BeforeCreate generates a UUID if not set
func (f *FeedEvent) BeforeCreate(tx *gorm.DB) error {
	if f.ID == uuid.Nil {
		f.ID = uuid.New()
	}
	return nil
}

// Badge represents an achievement badge
type Badge struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key" json:"id"`
	Name        string         `gorm:"size:100;unique;not null" json:"name"`
	Description string         `json:"description"`
	Icon        string         `gorm:"size:50" json:"icon"` // Icon name (e.g., "trophy", "star")
	Criteria    datatypes.JSON `gorm:"type:jsonb;default:'{}'" json:"criteria"`
}

// TableName sets the table name for Badge
func (Badge) TableName() string {
	return "badges"
}

// UserBadge represents a badge earned by a user
type UserBadge struct {
	UserID   uuid.UUID `gorm:"type:uuid;primary_key" json:"user_id"`
	BadgeID  uuid.UUID `gorm:"type:uuid;primary_key" json:"badge_id"`
	EarnedAt time.Time `json:"earned_at"`

	// Preloaded relations
	User  *User  `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Badge *Badge `gorm:"foreignKey:BadgeID" json:"badge,omitempty"`
}

// TableName sets the table name for UserBadge
func (UserBadge) TableName() string {
	return "user_badges"
}

// FeedFilters for fetching feed events
type FeedFilters struct {
	EventTypes []FeedEventType `form:"event_types"`
	Since      time.Time       `form:"since"`
	Page       int             `form:"page"`
	Limit      int             `form:"limit"`
}

// CreateFeedEvent helper to create a feed event
func CreateFeedEvent(actorID *uuid.UUID, eventType FeedEventType, targetType string, targetID *uuid.UUID, content string, metadata map[string]interface{}) *FeedEvent {
	metaJSON, _ := datatypes.NewJSONType(metadata).MarshalJSON()
	return &FeedEvent{
		ID:         uuid.New(),
		ActorID:    actorID,
		EventType:  eventType,
		TargetType: targetType,
		TargetID:   targetID,
		Content:    content,
		Metadata:   metaJSON,
		CreatedAt:  time.Now(),
	}
}
