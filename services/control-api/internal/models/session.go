package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type SessionType string

const (
	SessionRotating SessionType = "rotating"
	SessionSticky   SessionType = "sticky"
)

type SessionStatus string

const (
	SessionActive     SessionStatus = "active"
	SessionDisabled   SessionStatus = "disabled"
	SessionTerminated SessionStatus = "terminated"
)

type Session struct {
	ID              uuid.UUID     `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID          uuid.UUID     `gorm:"type:uuid;not null"`
	NodeID          *uuid.UUID    `gorm:"type:uuid"` // Nullable
	Type            SessionType   `gorm:"type:varchar(50);not null"`
	Status          SessionStatus `gorm:"type:varchar(50);default:'active'"`
	CredentialsUser string        `gorm:"type:varchar(255)"`
	CredentialsPass string        `gorm:"type:varchar(255)"`
	Config          string        `gorm:"type:jsonb"`
	ExpiresAt       *time.Time
	CreatedAt       time.Time
}

func (s *Session) BeforeCreate(tx *gorm.DB) (err error) {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return
}
