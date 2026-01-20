package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// Agent represents an AI Agent identity registered on the platform.
type Agent struct {
	ID              uuid.UUID      `gorm:"type:uuid;primary_key;" json:"id"`
	OwnerID         uuid.UUID      `gorm:"type:uuid;not null;index" json:"owner_id"`
	Name            string         `gorm:"type:varchar(100);not null" json:"name"`
	PublicKey       string         `gorm:"type:text;not null;unique" json:"public_key"` // Ed25519 Public Key
	Capabilities    datatypes.JSON `gorm:"type:jsonb" json:"capabilities"`              // e.g. ["content_creation", "market_analysis"]
	ReputationScore float64        `gorm:"default:0.0" json:"reputation_score"`
	Verified        bool           `gorm:"default:false" json:"verified"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"index" json:"-"`

	// Relationships
	Owner   User          `gorm:"foreignKey:OwnerID" json:"-"`
	Outputs []AgentOutput `gorm:"foreignKey:AgentID" json:"-"`
}

// AgentOutput represents a unit of work (content, action) produced by an Agent.
type AgentOutput struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;" json:"id"`
	AgentID     uuid.UUID      `gorm:"type:uuid;not null;index" json:"agent_id"`
	ContentHash string         `gorm:"type:varchar(64);not null;index" json:"content_hash"` // SHA256 hash of the content
	Signature   string         `gorm:"type:text;not null" json:"signature"`                 // Ed25519 Signature of the ContentHash
	Metadata    datatypes.JSON `gorm:"type:jsonb" json:"metadata"`                          // Extra info (timestamp, context, model used)
	Verified    bool           `gorm:"default:false" json:"verified"`                       // True if signature was verified against Agent.PublicKey
	CreatedAt   time.Time      `json:"created_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

// BeforeCreate hooks for generating UUIDs
func (a *Agent) BeforeCreate(tx *gorm.DB) (err error) {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return
}

func (ao *AgentOutput) BeforeCreate(tx *gorm.DB) (err error) {
	if ao.ID == uuid.Nil {
		ao.ID = uuid.New()
	}
	return
}
