package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

// SessionGatewayCache is the PG dual-write of Redis session:{username} JSON
// used by edge auth hydrate on Redis miss (Sprint J0 / EV-05 PARTIAL↑).
type SessionGatewayCache struct {
	CredentialsUserHash string         `gorm:"column:credentials_user_hash;type:varchar(64);primaryKey" json:"credentials_user_hash"`
	SessionID           uuid.UUID      `gorm:"type:uuid;not null;index:idx_session_gateway_cache_session" json:"session_id"`
	Payload             datatypes.JSON `gorm:"type:jsonb;not null" json:"payload"`
	ExpiresAt           time.Time      `gorm:"not null;index:idx_session_gateway_cache_expires" json:"expires_at"`
	UpdatedAt           time.Time      `gorm:"not null" json:"updated_at"`
}

func (SessionGatewayCache) TableName() string {
	return "session_gateway_cache"
}
