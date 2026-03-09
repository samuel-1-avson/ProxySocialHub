package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// SessionMetrics stores per-session quality measurements used for billing and provider scoring.
type SessionMetrics struct {
	ID           uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	SessionID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_session_metrics_session" json:"session_id"`
	AvgLatencyMs float64   `gorm:"default:0" json:"avg_latency_ms"`
	SuccessRate  float64   `gorm:"default:100" json:"success_rate"`   // 0–100
	BytesUp      int64     `gorm:"default:0" json:"bytes_up"`
	BytesDown    int64     `gorm:"default:0" json:"bytes_down"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`

	// Relations
	Session *Session `gorm:"foreignKey:SessionID" json:"session,omitempty"`
}

func (SessionMetrics) TableName() string {
	return "session_metrics"
}

func (s *SessionMetrics) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}
