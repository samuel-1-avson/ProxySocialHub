package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// MeteringWalSpillStatus is the drain lifecycle for EV-05 lite spill rows.
type MeteringWalSpillStatus string

const (
	MeteringWalSpillPending  MeteringWalSpillStatus = "pending"
	MeteringWalSpillDraining MeteringWalSpillStatus = "draining"
	MeteringWalSpillDrained  MeteringWalSpillStatus = "drained"
	MeteringWalSpillFailed   MeteringWalSpillStatus = "failed"
)

// MeteringWalSpill is an append-only Postgres mirror for metering bytes when
// the edge Redis WAL/pending write path fails (Sprint H / EV-05 lite).
type MeteringWalSpill struct {
	ID              uuid.UUID              `gorm:"type:uuid;primaryKey" json:"id"`
	SessionUsername string                 `gorm:"type:varchar(120);not null;index:idx_metering_wal_spill_session" json:"session_username"`
	BytesUp         int64                  `gorm:"not null;default:0" json:"bytes_up"`
	BytesDown       int64                  `gorm:"not null;default:0" json:"bytes_down"`
	Seq             *int64                 `gorm:"column:seq" json:"seq,omitempty"`
	Status          MeteringWalSpillStatus `gorm:"type:varchar(20);not null;default:'pending';index:idx_metering_wal_spill_status_created" json:"status"`
	Source          string                 `gorm:"type:varchar(64);not null;default:'redis_wal_fail'" json:"source"`
	Error           *string                `gorm:"type:text" json:"error,omitempty"`
	CreatedAt       time.Time              `json:"created_at"`
	DrainedAt       *time.Time             `json:"drained_at,omitempty"`
}

func (MeteringWalSpill) TableName() string {
	return "metering_wal_spill"
}

func (m *MeteringWalSpill) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	if m.Status == "" {
		m.Status = MeteringWalSpillPending
	}
	if m.Source == "" {
		m.Source = "redis_wal_fail"
	}
	if m.CreatedAt.IsZero() {
		m.CreatedAt = time.Now().UTC()
	}
	return nil
}
