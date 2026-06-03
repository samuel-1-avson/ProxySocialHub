package models

import (
	"time"

	"github.com/google/uuid"
)

// BetaProgramCompletion tracks a user's completed beta-program task.
type BetaProgramCompletion struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID      uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	TaskSlug    string    `gorm:"type:varchar(64);not null" json:"task_slug"`
	CompletedAt time.Time `json:"completed_at"`
	Source      string    `gorm:"type:varchar(32);not null;default:manual" json:"source"`
}

func (BetaProgramCompletion) TableName() string {
	return "beta_program_completions"
}
