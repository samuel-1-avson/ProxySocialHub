package models

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// UserFlag represents a security flag or freeze on a user account
type UserFlag struct {
	ID         uuid.UUID  `gorm:"type:uuid;primary_key" json:"id"`
	UserID     uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	FlagType   string     `gorm:"type:varchar(50);not null" json:"flag_type"`
	Reason     string     `gorm:"type:text" json:"reason"`
	Resolved   bool       `gorm:"default:false" json:"resolved"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// BeforeCreate hooks into GORM's lifecycle to generate a UUID
func (uf *UserFlag) BeforeCreate(tx *gorm.DB) (err error) {
	if uf.ID == uuid.Nil {
		uf.ID = uuid.New()
	}
	return
}

// ErrUserFrozen: unresolved security flags freeze all user-initiated
// money movement out of the account (W-34 uniform enforcement).
var ErrUserFrozen = fmt.Errorf("account is flagged: money movement frozen pending security review")

// UserFrozen reports whether the user has any unresolved UserFlag.
// Same semantics the withdrawal path has always enforced; now shared
// by P2P, earnings claim, and escrow release (W-34).
func UserFrozen(tx *gorm.DB, userID uuid.UUID) (bool, error) {
	var count int64
	if err := tx.Model(&UserFlag{}).Where("user_id = ? AND resolved = ?", userID, false).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}
