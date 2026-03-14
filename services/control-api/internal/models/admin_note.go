package models

import (
	"time"

	"github.com/google/uuid"
)

// AdminNote stores internal admin notes attached to a user account.
// These are never shown to the user — admin-eyes only.
type AdminNote struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	UserID        uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	AdminUsername string    `gorm:"size:100;not null" json:"admin_username"`
	Content       string    `gorm:"type:text;not null" json:"content"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (n *AdminNote) BeforeCreate(tx interface{}) error {
	if n.ID == uuid.Nil {
		n.ID = uuid.New()
	}
	return nil
}
