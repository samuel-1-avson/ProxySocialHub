package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ProviderApplication represents a user's application to become a provider
type ProviderApplication struct {
	ID         uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID     uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex" json:"user_id"`
	User       *User      `gorm:"foreignKey:UserID;references:ID" json:"user,omitempty"`
	Status     string     `gorm:"size:20;default:'pending'" json:"status"` // pending, approved, rejected
	ISP        string     `json:"isp"`
	Location   string     `json:"location"`
	Bandwidth  string     `json:"bandwidth"` // e.g., "100Mbps fiber"
	ReviewerID *uuid.UUID `gorm:"type:uuid" json:"reviewer_id"`
	Reviewer   *User      `gorm:"foreignKey:ReviewerID;references:ID" json:"reviewer,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// TableName sets the table name for ProviderApplication
func (ProviderApplication) TableName() string {
	return "provider_applications"
}

// BeforeCreate generates a UUID if not set
func (p *ProviderApplication) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}
