package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// AuditAction represents the type of action being audited
type AuditAction string

const (
	// User actions
	AuditUserCreated    AuditAction = "user.created"
	AuditUserBanned     AuditAction = "user.banned"
	AuditUserUnbanned   AuditAction = "user.unbanned"
	AuditUserTierUpdate AuditAction = "user.tier_updated"
	AuditUserLogin      AuditAction = "user.login"
	AuditUserLogout     AuditAction = "user.logout"
	Audit2FAEnabled     AuditAction = "user.2fa_enabled"
	Audit2FADisabled    AuditAction = "user.2fa_disabled"

	// KYC actions
	AuditKYCSubmitted AuditAction = "kyc.submitted"
	AuditKYCApproved  AuditAction = "kyc.approved"
	AuditKYCRejected  AuditAction = "kyc.rejected"

	// Session actions
	AuditSessionCreated    AuditAction = "session.created"
	AuditSessionTerminated AuditAction = "session.terminated"

	// Wallet actions
	AuditWalletDeposit    AuditAction = "wallet.deposit"
	AuditWalletWithdrawal AuditAction = "wallet.withdrawal"
	AuditWalletPayout     AuditAction = "wallet.payout"

	// API Key actions
	AuditAPIKeyCreated AuditAction = "api_key.created"
	AuditAPIKeyRevoked AuditAction = "api_key.revoked"

	// Node actions
	AuditNodeRegistered   AuditAction = "node.registered"
	AuditNodeDeactivated  AuditAction = "node.deactivated"
	AuditNodeHealthChange AuditAction = "node.health_changed"

	// Admin actions
	AuditAdminAccess  AuditAction = "admin.access"
	AuditConfigChange AuditAction = "admin.config_changed"
)

// AuditEntityType represents the type of entity affected
type AuditEntityType string

const (
	EntityUser    AuditEntityType = "user"
	EntitySession AuditEntityType = "session"
	EntityKYC     AuditEntityType = "kyc"
	EntityWallet  AuditEntityType = "wallet"
	EntityNode    AuditEntityType = "node"
	EntityAPIKey  AuditEntityType = "api_key"
	EntityCircle  AuditEntityType = "circle"
	EntitySystem  AuditEntityType = "system"
)

// AuditLog represents an audit trail entry
type AuditLog struct {
	ID         uuid.UUID       `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ActorID    *uuid.UUID      `gorm:"type:uuid" json:"actor_id,omitempty"`
	ActorEmail string          `gorm:"size:255" json:"actor_email"`
	Action     AuditAction     `gorm:"size:100;not null" json:"action"`
	EntityType AuditEntityType `gorm:"size:50;not null" json:"entity_type"`
	EntityID   string          `gorm:"size:100" json:"entity_id,omitempty"`
	Details    AuditDetails    `gorm:"type:jsonb" json:"details,omitempty"`
	IPAddress  string          `gorm:"size:45" json:"ip_address,omitempty"`
	UserAgent  string          `gorm:"size:500" json:"user_agent,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
}

// TableName specifies the table name for GORM
func (AuditLog) TableName() string {
	return "audit_logs"
}

// AuditDetails stores additional context about an action
type AuditDetails map[string]interface{}

// Scan implements sql.Scanner for JSONB
func (d *AuditDetails) Scan(value interface{}) error {
	if value == nil {
		*d = nil
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		if str, ok := value.(string); ok {
			bytes = []byte(str)
		}
	}
	return json.Unmarshal(bytes, d)
}

// Value implements driver.Valuer for JSONB
func (d AuditDetails) Value() (interface{}, error) {
	if d == nil {
		return nil, nil
	}
	return json.Marshal(d)
}

// NewAuditLog creates a new audit log entry
func NewAuditLog(actorID *uuid.UUID, actorEmail string, action AuditAction, entityType AuditEntityType, entityID string, details AuditDetails) *AuditLog {
	return &AuditLog{
		ActorID:    actorID,
		ActorEmail: actorEmail,
		Action:     action,
		EntityType: entityType,
		EntityID:   entityID,
		Details:    details,
	}
}

// WithIPAddress sets the IP address
func (l *AuditLog) WithIPAddress(ip string) *AuditLog {
	l.IPAddress = ip
	return l
}

// WithUserAgent sets the user agent
func (l *AuditLog) WithUserAgent(ua string) *AuditLog {
	l.UserAgent = ua
	return l
}
