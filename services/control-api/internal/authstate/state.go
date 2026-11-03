// Package authstate checks live authorization state without hydrating private PII.
package authstate

import (
	"errors"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"time"
)

var ErrInactive = errors.New("account or session inactive")

func Validate(userID, familyID string, requireSession bool) (string, error) {
	uid, err := uuid.Parse(userID)
	if err != nil || db.DB == nil {
		return "", ErrInactive
	}
	var account struct {
		ID     uuid.UUID
		Role   string
		Status string
	}
	if err = db.DB.Table("profiles").Select("id, role, status").Where("id = ?", uid).Take(&account).Error; err != nil {
		return "", ErrInactive
	}
	if account.Status != "active" && account.Status != "pending" {
		return "", ErrInactive
	}
	if requireSession {
		if familyID == "" {
			return "", ErrInactive
		} // legacy JWTs must reauthenticate
		var n int64
		if err = db.DB.Table("user_sessions").Where("user_id = ? AND token_family = ? AND is_active = ? AND expires_at > ?", uid, familyID, true, time.Now()).Count(&n).Error; err != nil || n != 1 {
			return "", ErrInactive
		}
	}
	return account.Role, nil
}
