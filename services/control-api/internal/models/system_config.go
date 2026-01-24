package models

import (
	"time"

	"github.com/google/uuid"
)

// SystemConfiguration stores global dynamic settings
type SystemConfiguration struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Key         string    `gorm:"type:varchar(100);unique;not null" json:"key"`
	Value       string    `gorm:"type:text;not null" json:"value"`
	Description string    `gorm:"type:text" json:"description"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (SystemConfiguration) TableName() string {
	return "system_configurations"
}
