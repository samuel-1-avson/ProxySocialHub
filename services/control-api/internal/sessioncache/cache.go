package sessioncache

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"gorm.io/datatypes"
	"gorm.io/gorm/clause"
)

// HashUsername returns sha256 hex of the plaintext proxy username (Redis key suffix).
func HashUsername(username string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(username)))
	return hex.EncodeToString(sum[:])
}

// Upsert dual-writes the Redis session blob into PG. Safe to call from
// redis.AfterStoreSession; no-ops when DB is unavailable.
func Upsert(username string, data *redisClient.SessionData, ttl time.Duration) error {
	if db.DB == nil || data == nil {
		return nil
	}
	username = strings.TrimSpace(username)
	if username == "" {
		return fmt.Errorf("sessioncache: empty username")
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	sessionID, err := uuid.Parse(strings.TrimSpace(data.SessionID))
	if err != nil {
		// Still cache under a nil UUID? Prefer skip — hydrate needs session_id.
		return fmt.Errorf("sessioncache: invalid session_id: %w", err)
	}
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	now := time.Now().UTC()
	row := models.SessionGatewayCache{
		CredentialsUserHash: HashUsername(username),
		SessionID:           sessionID,
		Payload:             datatypes.JSON(raw),
		ExpiresAt:           now.Add(ttl),
		UpdatedAt:           now,
	}
	return db.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "credentials_user_hash"}},
		DoUpdates: clause.AssignmentColumns([]string{"session_id", "payload", "expires_at", "updated_at"}),
	}).Create(&row).Error
}

// DeleteByUsername removes the dual-write row (best-effort on terminate).
func DeleteByUsername(username string) error {
	if db.DB == nil {
		return nil
	}
	username = strings.TrimSpace(username)
	if username == "" {
		return nil
	}
	return db.DB.Where("credentials_user_hash = ?", HashUsername(username)).
		Delete(&models.SessionGatewayCache{}).Error
}

// GetByUsername loads a non-expired cache row and unmarshals SessionData.
func GetByUsername(username string) (*redisClient.SessionData, time.Time, error) {
	if db.DB == nil {
		return nil, time.Time{}, fmt.Errorf("sessioncache: db unavailable")
	}
	username = strings.TrimSpace(username)
	if username == "" {
		return nil, time.Time{}, fmt.Errorf("sessioncache: empty username")
	}
	var row models.SessionGatewayCache
	err := db.DB.Where("credentials_user_hash = ? AND expires_at > ?", HashUsername(username), time.Now().UTC()).
		First(&row).Error
	if err != nil {
		return nil, time.Time{}, err
	}
	var data redisClient.SessionData
	if err := json.Unmarshal(row.Payload, &data); err != nil {
		return nil, time.Time{}, err
	}
	return &data, row.ExpiresAt, nil
}

// DeleteExpired removes session_gateway_cache rows past expires_at.
// Wave 2.2 — keeps the hydrate spill table from unbounded growth; Redis remains hot path.
func DeleteExpired(now time.Time, limit int) (int64, error) {
	if db.DB == nil {
		return 0, nil
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if limit <= 0 {
		limit = 500
	}
	var hashes []string
	if err := db.DB.Model(&models.SessionGatewayCache{}).
		Where("expires_at <= ?", now).
		Limit(limit).
		Pluck("credentials_user_hash", &hashes).Error; err != nil {
		return 0, err
	}
	if len(hashes) == 0 {
		return 0, nil
	}
	res := db.DB.Where("credentials_user_hash IN ?", hashes).Delete(&models.SessionGatewayCache{})
	return res.RowsAffected, res.Error
}
