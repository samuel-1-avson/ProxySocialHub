package models

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// TOTPBackupCode represents a one-time backup code for 2FA recovery
type TOTPBackupCode struct {
	ID        uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID    uuid.UUID  `gorm:"type:uuid;not null" json:"user_id"`
	CodeHash  string     `gorm:"not null" json:"-"`
	Used      bool       `gorm:"default:false" json:"used"`
	UsedAt    *time.Time `json:"used_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// TableName specifies the table name for GORM
func (TOTPBackupCode) TableName() string {
	return "totp_backup_codes"
}

// GenerateBackupCodes generates a set of backup codes for a user
// Returns the plaintext codes (to show to user) and the hashed code records
func GenerateBackupCodes(userID uuid.UUID, count int) ([]string, []TOTPBackupCode, error) {
	if count <= 0 {
		count = 10 // Default to 10 backup codes
	}

	plaintextCodes := make([]string, count)
	hashedCodes := make([]TOTPBackupCode, count)

	for i := 0; i < count; i++ {
		// Generate random 8-character code
		code := generateRandomCode(8)
		plaintextCodes[i] = code

		// Hash the code for storage
		hashed, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
		if err != nil {
			return nil, nil, err
		}

		hashedCodes[i] = TOTPBackupCode{
			UserID:   userID,
			CodeHash: string(hashed),
			Used:     false,
		}
	}

	return plaintextCodes, hashedCodes, nil
}

// VerifyBackupCode checks if the provided code matches this backup code
func (bc *TOTPBackupCode) VerifyBackupCode(code string) bool {
	if bc.Used {
		return false
	}
	err := bcrypt.CompareHashAndPassword([]byte(bc.CodeHash), []byte(code))
	return err == nil
}

// MarkAsUsed marks the backup code as used
func (bc *TOTPBackupCode) MarkAsUsed() {
	bc.Used = true
	now := time.Now()
	bc.UsedAt = &now
}

// generateRandomCode generates a random alphanumeric code
func generateRandomCode(length int) string {
	bytes := make([]byte, length/2+1)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)[:length]
}

// FormatBackupCode formats a backup code for display (with dashes)
func FormatBackupCode(code string) string {
	if len(code) <= 4 {
		return code
	}
	mid := len(code) / 2
	return code[:mid] + "-" + code[mid:]
}
