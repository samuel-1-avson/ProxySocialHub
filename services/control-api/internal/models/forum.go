package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// ============ Smart Matching ============

type UseCase struct {
	ID           uuid.UUID              `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Name         string                 `gorm:"type:varchar(100);unique;not null" json:"name"`
	Description  string                 `gorm:"type:text" json:"description"`
	Requirements map[string]interface{} `gorm:"type:jsonb;serializer:json" json:"requirements"`
	CreatedAt    time.Time              `json:"created_at"`
}

func (UseCase) TableName() string {
	return "use_cases"
}

type UserPreference struct {
	ID                    uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID                uuid.UUID      `gorm:"type:uuid;not null" json:"user_id"`
	PreferredUseCaseID    *uuid.UUID     `gorm:"type:uuid" json:"preferred_use_case_id,omitempty"`
	PreferredRegions      pq.StringArray `gorm:"type:text[]" json:"preferred_regions"`
	MaxPricePerGB         *float64       `gorm:"type:numeric(10,2)" json:"max_price_per_gb,omitempty"`
	MinSellerRating       *float64       `gorm:"type:numeric(3,2)" json:"min_seller_rating,omitempty"`
	PreferVerifiedSellers bool           `gorm:"default:true" json:"prefer_verified_sellers"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`

	UseCase *UseCase `gorm:"foreignKey:PreferredUseCaseID" json:"use_case,omitempty"`
}

func (UserPreference) TableName() string {
	return "user_preferences"
}

// ============ Community Forum ============

type ForumCategory struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Name        string    `gorm:"type:varchar(100);unique;not null" json:"name"`
	Slug        string    `gorm:"type:varchar(100);unique;not null" json:"slug"`
	Description string    `gorm:"type:text" json:"description"`
	Icon        string    `gorm:"type:varchar(50)" json:"icon"`
	SortOrder   int       `gorm:"default:0" json:"sort_order"`
	IsLocked    bool      `gorm:"default:false" json:"is_locked"`
	CreatedAt   time.Time `json:"created_at"`
}

func (ForumCategory) TableName() string {
	return "forum_categories"
}

type ForumThread struct {
	ID           uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	CategoryID   uuid.UUID  `gorm:"type:uuid;not null" json:"category_id"`
	AuthorID     uuid.UUID  `gorm:"type:uuid;not null" json:"author_id"`
	Title        string     `gorm:"type:varchar(255);not null" json:"title"`
	Slug         string     `gorm:"type:varchar(255);not null" json:"slug"`
	Content      string     `gorm:"type:text;not null" json:"content"`
	IsPinned     bool       `gorm:"default:false" json:"is_pinned"`
	IsLocked     bool       `gorm:"default:false" json:"is_locked"`
	ViewsCount   int        `gorm:"default:0" json:"views_count"`
	RepliesCount int        `gorm:"default:0" json:"replies_count"`
	Upvotes      int        `gorm:"default:0" json:"upvotes"`
	Downvotes    int        `gorm:"default:0" json:"downvotes"`
	LastReplyAt  *time.Time `json:"last_reply_at,omitempty"`
	LastReplyBy  *uuid.UUID `gorm:"type:uuid" json:"last_reply_by,omitempty"`
	ListingID    *uuid.UUID `gorm:"type:uuid;index:idx_forum_threads_listing" json:"listing_id,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`

	Category    *ForumCategory `gorm:"foreignKey:CategoryID" json:"category,omitempty"`
	Author      *User          `gorm:"foreignKey:AuthorID" json:"author,omitempty"`
	LastReplier *User          `gorm:"foreignKey:LastReplyBy" json:"last_replier,omitempty"`
}

func (ForumThread) TableName() string {
	return "forum_threads"
}

type ForumPost struct {
	ID         uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ThreadID   uuid.UUID  `gorm:"type:uuid;not null" json:"thread_id"`
	AuthorID   uuid.UUID  `gorm:"type:uuid;not null" json:"author_id"`
	Content    string     `gorm:"type:text;not null" json:"content"`
	IsSolution bool       `gorm:"default:false" json:"is_solution"`
	Upvotes    int        `gorm:"default:0" json:"upvotes"`
	Downvotes  int        `gorm:"default:0" json:"downvotes"`
	ParentID   *uuid.UUID `gorm:"type:uuid" json:"parent_id,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`

	Author *User `gorm:"foreignKey:AuthorID" json:"author,omitempty"`
}

func (ForumPost) TableName() string {
	return "forum_posts"
}

type ForumVote struct {
	ID        uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID    uuid.UUID  `gorm:"type:uuid;not null" json:"user_id"`
	PostID    *uuid.UUID `gorm:"type:uuid" json:"post_id,omitempty"`      // For post votes
	ThreadID  *uuid.UUID `gorm:"type:uuid" json:"thread_id,omitempty"`    // For thread votes
	VoteType  int        `gorm:"type:smallint;not null" json:"vote_type"` // 1 or -1
	CreatedAt time.Time  `json:"created_at"`
}

func (ForumVote) TableName() string {
	return "forum_votes"
}

// ForumReport represents a user report on a thread or post
type ForumReport struct {
	ID         uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ReporterID uuid.UUID  `gorm:"type:uuid;not null" json:"reporter_id"`
	ThreadID   *uuid.UUID `gorm:"type:uuid" json:"thread_id,omitempty"`
	PostID     *uuid.UUID `gorm:"type:uuid" json:"post_id,omitempty"`
	Reason     string     `gorm:"type:varchar(50);not null" json:"reason"`
	Details    string     `gorm:"type:text" json:"details"`
	Status     string     `gorm:"type:varchar(20);default:'pending'" json:"status"` // pending, resolved, dismissed
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func (ForumReport) TableName() string {
	return "forum_reports"
}
