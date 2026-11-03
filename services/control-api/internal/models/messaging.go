package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Conversation represents a direct message thread between two users
type Conversation struct {
	ID            uuid.UUID  `gorm:"type:uuid;primary_key" json:"id"`
	Participant1  uuid.UUID  `gorm:"type:uuid;not null" json:"participant1"`
	Participant2  uuid.UUID  `gorm:"type:uuid;not null" json:"participant2"`
	ListingID     *uuid.UUID `gorm:"type:uuid" json:"listing_id,omitempty"` // Optional context
	LastMessageAt time.Time  `json:"last_message_at"`
	CreatedAt     time.Time  `json:"created_at"`

	// Preloaded relations
	User1    *User         `gorm:"foreignKey:Participant1" json:"user1,omitempty"`
	User2    *User         `gorm:"foreignKey:Participant2" json:"user2,omitempty"`
	Listing  *ProxyListing `gorm:"foreignKey:ListingID" json:"listing,omitempty"`
	Messages []Message     `gorm:"foreignKey:ConversationID" json:"messages,omitempty"`
}

// TableName sets the table name for Conversation
func (Conversation) TableName() string {
	return "conversations"
}

// BeforeCreate generates a UUID if not set
func (c *Conversation) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	if c.LastMessageAt.IsZero() {
		c.LastMessageAt = time.Now()
	}
	return nil
}

// GetOtherParticipant returns the other user in the conversation
func (c *Conversation) GetOtherParticipant(userID uuid.UUID) uuid.UUID {
	if c.Participant1 == userID {
		return c.Participant2
	}
	return c.Participant1
}

// Message represents a single message in a conversation
type Message struct {
	ID             uuid.UUID  `gorm:"type:uuid;primary_key" json:"id"`
	ConversationID uuid.UUID  `gorm:"type:uuid;not null" json:"conversation_id"`
	SenderID       uuid.UUID  `gorm:"type:uuid;not null" json:"sender_id"`
	Content        string     `gorm:"not null" json:"content"`
	ReadAt         *time.Time `json:"read_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`

	// Enhanced messaging fields
	Type      string     `gorm:"size:20;default:'text'" json:"type"`
	ReplyToID *uuid.UUID `gorm:"type:uuid" json:"reply_to_id,omitempty"`
	EditedAt  *time.Time `json:"edited_at,omitempty"`
	IsDeleted bool       `gorm:"default:false" json:"is_deleted"`
	// ClientMsgID is the client-generated idempotency key for the send that
	// created this message (migration 000177). Unique per
	// (conversation_id, sender_id) when present.
	ClientMsgID *string `gorm:"column:client_msg_id;size:128" json:"client_msg_id,omitempty"`

	// Preloaded relations
	Sender       *User             `gorm:"foreignKey:SenderID" json:"sender,omitempty"`
	Conversation *Conversation     `gorm:"foreignKey:ConversationID" json:"conversation,omitempty"`
	Reactions    []MessageReaction `gorm:"foreignKey:MessageID" json:"reactions,omitempty"`
}

// MessageReaction represents a reaction to a message
type MessageReaction struct {
	MessageID uuid.UUID `gorm:"type:uuid;primaryKey" json:"message_id"`
	UserID    uuid.UUID `gorm:"type:uuid;primaryKey" json:"user_id"`
	Emoji     string    `gorm:"size:10;primaryKey" json:"emoji"`
	CreatedAt time.Time `json:"created_at"`
}

// TableName sets the table name for MessageReaction
func (MessageReaction) TableName() string {
	return "message_reactions"
}

// TableName sets the table name for Message
func (Message) TableName() string {
	return "messages"
}

// BeforeCreate generates a UUID if not set
func (m *Message) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}

// IsRead returns true if the message has been read
func (m *Message) IsRead() bool {
	return m.ReadAt != nil
}

// StartConversationRequest represents a request to start a new conversation
type StartConversationRequest struct {
	RecipientID uuid.UUID  `json:"recipient_id" binding:"required"`
	ListingID   *uuid.UUID `json:"listing_id"`
	Message     string     `json:"message" binding:"required,min=1,max=2000"`
	ClientMsgID string     `json:"client_msg_id" binding:"omitempty,max=128"`
}

// SendMessageRequest represents a request to send a message
type SendMessageRequest struct {
	Content string `json:"content" binding:"required,min=1,max=2000"`
}

// ConversationWithPreview includes the last message for list display
type ConversationWithPreview struct {
	Conversation
	LastMessage      *Message `json:"last_message,omitempty"`
	UnreadCount      int      `json:"unread_count"`
	OtherParticipant *User    `json:"other_participant,omitempty"`
}
