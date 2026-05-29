package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// UserFlag represents a security flag or freeze on a user account
type UserFlag struct {
	ID         uuid.UUID  `gorm:"type:uuid;primary_key" json:"id"`
	UserID     uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	FlagType   string     `gorm:"type:varchar(50);not null" json:"flag_type"`
	Reason     string     `gorm:"type:text" json:"reason"`
	Resolved   bool       `gorm:"default:false" json:"resolved"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// BeforeCreate hooks into GORM's lifecycle to generate a UUID
func (uf *UserFlag) BeforeCreate(tx *gorm.DB) (err error) {
	if uf.ID == uuid.Nil {
		uf.ID = uuid.New()
	}
	return
}
