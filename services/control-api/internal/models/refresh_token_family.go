package models

import (
	"time"

	"github.com/google/uuid"
)

type RefreshTokenFamily struct {
	ID            uuid.UUID  `gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	FamilyID      string     `gorm:"size:64;not null"`
	UserID        uuid.UUID  `gorm:"type:uuid;not null"`
	TokenID       string     `gorm:"size:64;not null"`
	TokenHash     string     `gorm:"size:128;not null;uniqueIndex"`
	ParentTokenID string     `gorm:"size:64"`
	IssuedAt      time.Time  `gorm:"not null"`
	ExpiresAt     time.Time  `gorm:"not null"`
	RevokedAt     *time.Time `gorm:"index"`
	IsCurrent     bool       `gorm:"default:true;index"`
}
