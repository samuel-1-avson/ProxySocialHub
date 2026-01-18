package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// PendingTransaction tracks MoMo transactions awaiting webhook confirmation
type PendingTransaction struct {
	ID            uuid.UUID `gorm:"type:uuid;primary_key"`
	Reference     string    `gorm:"type:varchar(100);unique;not null"` // Our internal reference
	ExternalRef   string    `gorm:"type:varchar(100)"`                 // Provider's transaction ID
	UserID        string    `gorm:"type:varchar(100);not null"`
	Type          string    `gorm:"type:varchar(20);not null"` // "deposit" or "withdrawal"
	Amount        float64   `gorm:"type:numeric(20,4);not null"`
	Currency      string    `gorm:"type:varchar(3);default:'GHS'"`
	Provider      string    `gorm:"type:varchar(20);not null"` // "mtn", "vodafone", "airteltigo"
	Phone         *string   `gorm:"type:varchar(20)"`
	Status        string    `gorm:"type:varchar(20);default:'pending'"` // "pending", "completed", "failed"
	FailureReason string    `gorm:"type:text"`
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func (p *PendingTransaction) BeforeCreate(tx *gorm.DB) (err error) {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return
}
