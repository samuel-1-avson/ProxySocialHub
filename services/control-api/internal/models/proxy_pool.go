package models

import (
	"time"

	"github.com/google/uuid"
)

// ProxyPool represents a named collection of proxy sessions for bulk API use
type ProxyPool struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	UserID      uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Name        string    `gorm:"size:100;not null" json:"name"`
	Description string    `gorm:"size:500" json:"description"`
	Size        int       `gorm:"default:10" json:"size"`                        // number of proxy endpoints in pool
	SessionType string    `gorm:"size:20;default:'rotating'" json:"session_type"` // rotating|sticky
	Status      string    `gorm:"size:20;default:'active'" json:"status"`         // active|paused|depleted|deleted
	BytesUsed   int64     `gorm:"default:0" json:"bytes_used"`
	BytesLimit  int64     `gorm:"default:0" json:"bytes_limit"` // 0 = unlimited
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
