package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AuditEventType categorizes audit events
type AuditEventType string

const (
	// Authentication Events
	AuditAuthLogin         AuditEventType = "auth.login"
	AuditAuthLoginFailed   AuditEventType = "auth.login_failed"
	AuditAuthLogout        AuditEventType = "auth.logout"
	AuditAuthMFAEnabled    AuditEventType = "auth.mfa_enabled"
	AuditAuthMFADisabled   AuditEventType = "auth.mfa_disabled"
	AuditAuthMFAVerified   AuditEventType = "auth.mfa_verified"
	AuditAuthPasswordReset AuditEventType = "auth.password_reset"
	AuditAuthSessionRevoke AuditEventType = "auth.session_revoked"

	// User Events
	AuditUserCreated     AuditEventType = "user.created"
	AuditUserUpdated     AuditEventType = "user.updated"
	AuditUserDeleted     AuditEventType = "user.deleted"
	AuditProfileUpdated  AuditEventType = "user.profile_updated"
	AuditSettingsChanged AuditEventType = "user.settings_changed"

	// Wallet Events
	AuditWalletLinked   AuditEventType = "wallet.linked"
	AuditWalletUnlinked AuditEventType = "wallet.unlinked"
	AuditWalletDeposit  AuditEventType = "wallet.deposit"
	AuditWalletWithdraw AuditEventType = "wallet.withdraw"

	// Order Events
	AuditOrderCreated   AuditEventType = "order.created"
	AuditOrderCompleted AuditEventType = "order.completed"
	AuditOrderCancelled AuditEventType = "order.cancelled"
	AuditOrderDisputed  AuditEventType = "order.disputed"

	// Provider Events
	AuditNodeRegistered   AuditEventType = "provider.node_registered"
	AuditNodeUpdated      AuditEventType = "provider.node_updated"
	AuditNodeDeregistered AuditEventType = "provider.node_deregistered"
	AuditListingCreated   AuditEventType = "provider.listing_created"
	AuditListingUpdated   AuditEventType = "provider.listing_updated"

	// Security Events
	AuditSecurityLockout   AuditEventType = "security.lockout"
	AuditSecurityUnlock    AuditEventType = "security.unlock"
	AuditSecurityAnomaly   AuditEventType = "security.anomaly_detected"
	AuditSecurityRateLimit AuditEventType = "security.rate_limited"

	// Admin Events
	AuditAdminAction          AuditEventType = "admin.action"
	AuditAdminListingApproved AuditEventType = "admin.listing_approved"
	AuditAdminListingRejected AuditEventType = "admin.listing_rejected"
	AuditDisputeResolved      AuditEventType = "admin.dispute_resolved"

	// Financial Events — P2-13: Comprehensive financial audit trail.
	AuditFinancialEscrowSettled  AuditEventType = "financial.escrow_settled"
	AuditFinancialEscrowRefunded AuditEventType = "financial.escrow_refunded"
	AuditFinancialBatchPayout    AuditEventType = "financial.batch_payout"
	AuditFinancialAutoDeposit    AuditEventType = "financial.auto_deposit"
	AuditFinancialWithdrawal     AuditEventType = "financial.withdrawal"
	AuditFinancialTransfer       AuditEventType = "financial.transfer"
)

// AuditSeverity indicates importance of the event
type AuditSeverity string

const (
	AuditSeverityInfo     AuditSeverity = "info"
	AuditSeverityWarning  AuditSeverity = "warning"
	AuditSeverityCritical AuditSeverity = "critical"
)

// AuditLog records all security-relevant events
type AuditLog struct {
	ID uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`

	// Event Classification
	EventType AuditEventType `gorm:"type:varchar(50);not null;index:idx_audit_type" json:"event_type"`
	Severity  AuditSeverity  `gorm:"type:varchar(20);default:'info'" json:"severity"`

	// Actor (who performed the action)
	ActorID    *uuid.UUID `gorm:"type:uuid;index:idx_audit_actor" json:"actor_id,omitempty"`
	ActorType  string     `gorm:"type:varchar(20)" json:"actor_type"` // user, admin, system
	ActorEmail string     `gorm:"type:varchar(255)" json:"actor_email,omitempty"`

	// Target (what was affected)
	TargetType string `gorm:"type:varchar(50)" json:"target_type,omitempty"` // user, order, node, etc.
	TargetID   string `gorm:"type:varchar(64)" json:"target_id,omitempty"`

	// Context
	IPAddress string     `gorm:"type:varchar(45);index:idx_audit_ip" json:"ip_address,omitempty"`
	UserAgent string     `gorm:"type:text" json:"user_agent,omitempty"`
	Country   string     `gorm:"type:varchar(2)" json:"country,omitempty"`
	SessionID *uuid.UUID `gorm:"type:uuid" json:"session_id,omitempty"`

	// Details
	Description string `gorm:"type:text" json:"description"`
	Metadata    string `gorm:"type:jsonb" json:"metadata,omitempty"` // Additional context as JSON

	// Outcome
	Success   bool   `gorm:"default:true" json:"success"`
	ErrorCode string `gorm:"type:varchar(50)" json:"error_code,omitempty"`

	// Timing
	CreatedAt time.Time `gorm:"index:idx_audit_created" json:"created_at"`
}

func (AuditLog) TableName() string {
	return "audit_logs"
}

func (a *AuditLog) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}

// SecurityAnomaly records detected suspicious activity
type SecurityAnomaly struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index:idx_anomaly_user" json:"user_id"`

	// Anomaly Type
	AnomalyType string `gorm:"type:varchar(50);not null" json:"anomaly_type"`     // geo_change, device_change, time_anomaly, velocity
	Severity    string `gorm:"type:varchar(20);default:'medium'" json:"severity"` // low, medium, high, critical

	// Detection Context
	DetectedIP      string `gorm:"type:varchar(45)" json:"detected_ip"`
	DetectedUA      string `gorm:"type:text" json:"detected_ua"`
	DetectedCountry string `gorm:"type:varchar(2)" json:"detected_country"`
	DetectedCity    string `gorm:"type:varchar(100)" json:"detected_city"`

	// Comparison (what was expected)
	ExpectedIP      string `gorm:"type:varchar(45)" json:"expected_ip,omitempty"`
	ExpectedCountry string `gorm:"type:varchar(2)" json:"expected_country,omitempty"`

	// Score & Decision
	RiskScore   float64 `gorm:"default:0" json:"risk_score"`          // 0-100
	ActionTaken string  `gorm:"type:varchar(50)" json:"action_taken"` // none, alert, block, require_mfa

	// Status
	IsResolved bool       `gorm:"default:false" json:"is_resolved"`
	ResolvedBy *uuid.UUID `gorm:"type:uuid" json:"resolved_by,omitempty"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
	Resolution string     `gorm:"type:text" json:"resolution,omitempty"`

	// Metadata
	Details string `gorm:"type:jsonb" json:"details,omitempty"` // Raw detection data

	CreatedAt time.Time `gorm:"index" json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Relations
	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (SecurityAnomaly) TableName() string {
	return "security_anomalies"
}

func (s *SecurityAnomaly) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}

// WebAuthnCredential stores passkey/security key credentials
type WebAuthnCredential struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index:idx_webauthn_user" json:"user_id"`

	// Credential Info
	CredentialID    string `gorm:"type:text;not null;uniqueIndex" json:"credential_id"`
	PublicKey       string `gorm:"type:text;not null" json:"-"` // Base64 encoded
	AttestationType string `gorm:"type:varchar(50)" json:"attestation_type"`

	// Authenticator Info
	AAGUID       string `gorm:"type:varchar(36)" json:"aaguid,omitempty"` // Authenticator ID
	SignCount    uint32 `gorm:"default:0" json:"sign_count"`
	CloneWarning bool   `gorm:"default:false" json:"clone_warning"`

	// Metadata
	Name       string `gorm:"type:varchar(100);not null" json:"name"` // User-given name
	DeviceType string `gorm:"type:varchar(50)" json:"device_type"`    // platform, cross-platform
	Transports string `gorm:"type:text" json:"transports,omitempty"`  // JSON array: usb, nfc, ble, internal

	// Status
	IsActive   bool       `gorm:"default:true" json:"is_active"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Relations
	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (WebAuthnCredential) TableName() string {
	return "webauthn_credentials"
}

func (w *WebAuthnCredential) BeforeCreate(tx *gorm.DB) error {
	if w.ID == uuid.Nil {
		w.ID = uuid.New()
	}
	return nil
}
