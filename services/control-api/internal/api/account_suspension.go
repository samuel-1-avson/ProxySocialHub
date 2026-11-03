package api

import (
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"gorm.io/gorm"
	"time"
)

// Disabling an account permanently revokes its authorization families. Unbanning
// requires a new login and cannot revive a token copied before the suspension.
func setAccountUnavailable(uid uuid.UUID, status models.UserStatus) error {
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		if err := tx.Model(&models.User{}).Where("id = ?", uid).Update("status", status).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.RefreshTokenFamily{}).Where("user_id = ?", uid).Updates(map[string]interface{}{"revoked_at": now, "is_current": false}).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.UserSession{}).Where("user_id = ?", uid).Updates(map[string]interface{}{"is_active": false, "revoked_at": now, "revoke_reason": "Account unavailable"}).Error; err != nil {
			return err
		}
		return tx.Model(&models.ExtensionDevice{}).Where("user_id = ?", uid).Updates(map[string]interface{}{"revoked_at": now, "refresh_expires_at": now}).Error
	})
	if err != nil {
		return err
	}
	// Delete the actual credential keys, including the durable cache cleanup hook.
	// The profile status already denies fresh API admission if Redis is unavailable.
	var sessions []models.Session
	if err := db.DB.Where("user_id = ? AND status = ?", uid, models.SessionActive).Find(&sessions).Error; err != nil {
		return err
	}
	for _, session := range sessions {
		if err := redisClient.DeleteSession(session.CredentialsUser); err != nil {
			return err
		}
	}
	return nil
}
