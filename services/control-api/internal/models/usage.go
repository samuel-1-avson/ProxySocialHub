package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// UsageRecord tracks bandwidth usage per request/session
type UsageRecord struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;index;not null" json:"user_id"`
	SessionID uuid.UUID `gorm:"type:uuid;index;not null" json:"session_id"`
	NodeID    *uuid.UUID `gorm:"type:uuid" json:"node_id,omitempty"`
	BytesUsed int64     `gorm:"not null;default:0" json:"bytes_used"`
	BytesUp   int64     `gorm:"default:0" json:"bytes_up"`
	BytesDown int64     `gorm:"default:0" json:"bytes_down"`
	DestHost  string    `gorm:"type:varchar(255)" json:"dest_host,omitempty"`
	DestPort  int       `json:"dest_port,omitempty"`
	LatencyMs int       `json:"latency_ms,omitempty"`
	Success   bool      `gorm:"default:true" json:"success"`
	CreatedAt time.Time `gorm:"index" json:"created_at"`
}

func (u *UsageRecord) BeforeCreate(tx *gorm.DB) (err error) {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	return
}

// UsageSummary provides aggregated usage stats
type UsageSummary struct {
	SessionID      uuid.UUID `json:"session_id"`
	TotalBytes     int64     `json:"total_bytes"`
	TotalBytesUp   int64     `json:"total_bytes_up"`
	TotalBytesDown int64     `json:"total_bytes_down"`
	RequestCount   int64     `json:"request_count"`
	SuccessCount   int64     `json:"success_count"`
	FailureCount   int64     `json:"failure_count"`
	SuccessRate    float64   `json:"success_rate"`
	AvgLatencyMs   float64   `json:"avg_latency_ms"`
	FirstRequest   time.Time `json:"first_request"`
	LastRequest    time.Time `json:"last_request"`
}
