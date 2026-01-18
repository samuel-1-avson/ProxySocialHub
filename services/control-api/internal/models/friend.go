package models

import (
	"time"

	"github.com/google/uuid"
)

// FriendRequestStatus represents the status of a friend request
type FriendRequestStatus string

const (
	FriendRequestPending  FriendRequestStatus = "pending"
	FriendRequestAccepted FriendRequestStatus = "accepted"
	FriendRequestRejected FriendRequestStatus = "rejected"
)

// FriendRequest represents a request from one user to another
type FriendRequest struct {
	ID         uuid.UUID           `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	SenderID   uuid.UUID           `gorm:"type:uuid;not null;index" json:"sender_id"`
	ReceiverID uuid.UUID           `gorm:"type:uuid;not null;index" json:"receiver_id"`
	Status     FriendRequestStatus `gorm:"type:varchar(20);default:'pending'" json:"status"`
	CreatedAt  time.Time           `json:"created_at"`
	UpdatedAt  time.Time           `json:"updated_at"`

	// Relationships
	Sender   User `gorm:"foreignKey:SenderID" json:"sender,omitempty"`
	Receiver User `gorm:"foreignKey:ReceiverID" json:"receiver,omitempty"`
}

// Friendship represents an established friend connection
// modeled as a unidirectional row, but logic should probably enforce bidirectionality or specific queries
// Often easier to query if we store two rows (A->B and B->A) or query (A=u OR B=u)
// For simplicity here, we'll assume the API handles the logic, but usually "Friendships" are stored as unique pairs
type Friendship struct {
	ID        uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;index:idx_friendship_user_friend,unique" json:"user_id"`
	FriendID  uuid.UUID `gorm:"type:uuid;not null;index:idx_friendship_user_friend,unique" json:"friend_id"`
	CreatedAt time.Time `json:"created_at"`

	// Relationships
	User   User `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Friend User `gorm:"foreignKey:FriendID" json:"friend,omitempty"`
}

// BeforeCreate hooks can be added here if needed
