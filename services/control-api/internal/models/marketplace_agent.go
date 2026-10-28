package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// MarketAgent represents a template for an AI agent available for rent
type MarketAgent struct {
	ID          uuid.UUID      `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	Name        string         `gorm:"not null" json:"name"`
	Description string         `json:"description"`
	Version     string         `gorm:"not null" json:"version"`
	PricePerRun float64        `gorm:"not null" json:"price_per_run"` // Cost in credit
	DockerImage string         `gorm:"not null" json:"docker_image"`  // Image to execute
	Categories  []string       `gorm:"serializer:json" json:"categories"`
	Parameters  map[string]any `gorm:"serializer:json;default:'{}'" json:"parameters"` // JSON schema of inputs; column is NOT NULL DEFAULT '{}'
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

// AgentInstance represents a user's active configuration of an agent
type AgentInstance struct {
	ID            uuid.UUID      `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	UserID        uuid.UUID      `gorm:"type:uuid;not null" json:"user_id"`
	MarketAgentID uuid.UUID      `gorm:"type:uuid;not null" json:"market_agent_id"`
	Name          string         `json:"name"`                           // User's custom name
	Config        map[string]any `gorm:"serializer:json" json:"config"`  // User's input values
	Status        string         `gorm:"default:'active'" json:"status"` // active, paused
	Schedule      string         `json:"schedule"`                       // cron expression (optional)
	LastRunAt     *time.Time     `json:"last_run_at"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index" json:"-"`

	// Relations
	MarketAgent MarketAgent `gorm:"foreignKey:MarketAgentID" json:"market_agent"`
	User        User        `gorm:"foreignKey:UserID" json:"-"`
}

// AgentJob represents a single execution of an agent
type AgentJob struct {
	ID              uuid.UUID      `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	AgentInstanceID uuid.UUID      `gorm:"type:uuid;not null" json:"agent_instance_id"`
	Status          string         `gorm:"default:'pending'" json:"status"` // pending, running, completed, failed
	Result          map[string]any `gorm:"serializer:json;default:'{}'" json:"result"` // column is NOT NULL DEFAULT '{}'
	Logs            string         `gorm:"type:text" json:"logs"`
	DurationSec     float64        `json:"duration_sec"`
	Cost            float64        `json:"cost"`
	StartedAt       *time.Time     `json:"started_at"`
	CompletedAt     *time.Time     `json:"completed_at"`
	CreatedAt       time.Time      `json:"created_at"`

	// Relation
	AgentInstance AgentInstance `gorm:"foreignKey:AgentInstanceID" json:"-"`
}
