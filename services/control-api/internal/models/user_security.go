package models

import (
	"crypto/rand"
	"encoding/base32"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// UserSettings stores user preferences and security settings
type UserSettings struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_settings_user" json:"user_id"`

	// MFA/TOTP Settings
	TwoFactorEnabled     bool       `gorm:"default:false" json:"two_factor_enabled"`
	TwoFactorSecret      string     `gorm:"type:varchar(64)" json:"-"` // Encrypted, never exposed
	TwoFactorBackupCodes string     `gorm:"type:text" json:"-"`        // JSON array of hashed backup codes
	TwoFactorVerifiedAt  *time.Time `json:"two_factor_verified_at,omitempty"`

	// Session Settings
	SessionTimeout        int    `gorm:"default:1440" json:"session_timeout"` // Minutes (default 24h)
	MaxConcurrentSessions int    `gorm:"default:5" json:"max_concurrent_sessions"`
	AllowedIPRanges       string `gorm:"type:text" json:"allowed_ip_ranges,omitempty"` // JSON array

	// Notification Settings
	NotifyOnNewLogin       bool `gorm:"default:true" json:"notify_on_new_login"`
	NotifyOnPasswordChange bool `gorm:"default:true" json:"notify_on_password_change"`
	NotifyOnNewSession     bool `gorm:"default:false" json:"notify_on_new_session"`

	// Preferences
	PreferredLanguage string `gorm:"type:varchar(10);default:'en'" json:"preferred_language"`
	Theme             string `gorm:"type:varchar(20);default:'system'" json:"theme"` // light, dark, system
	Timezone          string `gorm:"type:varchar(50);default:'UTC'" json:"timezone"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Relations
	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (UserSettings) TableName() string {
	return "user_settings"
}

func (s *UserSettings) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}

// GenerateTOTPSecret generates a new TOTP secret for the user
func GenerateTOTPSecret() (string, error) {
	secret := make([]byte, 20)
	_, err := rand.Read(secret)
	if err != nil {
		return "", err
	}
	return base32.StdEncoding.EncodeToString(secret), nil
}

// UserSession tracks active user sessions with fingerprinting
type UserSession struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index:idx_usersession_user" json:"user_id"`

	// Token
	RefreshToken string `gorm:"type:varchar(255);uniqueIndex:idx_usersession_token" json:"-"`
	TokenFamily  string `gorm:"type:varchar(64);index" json:"token_family"` // For rotation tracking

	// Fingerprint
	IPAddress   string `gorm:"type:varchar(45);not null" json:"ip_address"`
	UserAgent   string `gorm:"type:text" json:"user_agent"`
	Fingerprint string `gorm:"type:varchar(64)" json:"fingerprint"` // SHA256 of device info

	// Geolocation
	Country string `gorm:"type:varchar(2)" json:"country,omitempty"`
	City    string `gorm:"type:varchar(100)" json:"city,omitempty"`

	// Device Info
	DeviceType string `gorm:"type:varchar(20)" json:"device_type"` // desktop, mobile, tablet
	Browser    string `gorm:"type:varchar(50)" json:"browser,omitempty"`
	OS         string `gorm:"type:varchar(50)" json:"os,omitempty"`

	// Status
	IsActive     bool       `gorm:"default:true;index:idx_usersession_active" json:"is_active"`
	RevokedAt    *time.Time `json:"revoked_at,omitempty"`
	RevokeReason string     `gorm:"type:varchar(100)" json:"revoke_reason,omitempty"`

	// Timing
	LastActiveAt time.Time `gorm:"index" json:"last_active_at"`
	ExpiresAt    time.Time `gorm:"index" json:"expires_at"`
	CreatedAt    time.Time `json:"created_at"`

	// Relations
	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (UserSession) TableName() string {
	return "user_sessions"
}

func (s *UserSession) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	s.LastActiveAt = time.Now()
	return nil
}

// IsValid checks if session is still valid
func (s *UserSession) IsValid() bool {
	return s.IsActive && time.Now().Before(s.ExpiresAt)
}

// Revoke invalidates this session
func (s *UserSession) Revoke(reason string) {
	s.IsActive = false
	now := time.Now()
	s.RevokedAt = &now
	s.RevokeReason = reason
}

// LoginAttempt tracks login attempts for lockout
type LoginAttempt struct {
	ID uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`

	// Identifier
	Identifier     string `gorm:"type:varchar(255);not null;index:idx_attempt_identifier" json:"identifier"` // IP, email, or wallet
	IdentifierType string `gorm:"type:varchar(20);not null" json:"identifier_type"`                          // ip, email, wallet

	// Attempt Info
	Success       bool   `gorm:"default:false" json:"success"`
	FailureReason string `gorm:"type:varchar(100)" json:"failure_reason,omitempty"`

	// Context
	IPAddress string `gorm:"type:varchar(45);not null;index:idx_attempt_ip" json:"ip_address"`
	UserAgent string `gorm:"type:text" json:"user_agent,omitempty"`

	CreatedAt time.Time `gorm:"index" json:"created_at"`
}

func (LoginAttempt) TableName() string {
	return "login_attempts"
}

func (a *LoginAttempt) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}

// AccountLockout tracks locked accounts
type AccountLockout struct {
	ID uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`

	// Account
	Identifier     string `gorm:"type:varchar(255);not null;uniqueIndex:idx_lockout_identifier" json:"identifier"`
	IdentifierType string `gorm:"type:varchar(20);not null" json:"identifier_type"`

	// Lockout Info
	FailedAttempts int        `gorm:"default:0" json:"failed_attempts"`
	LockedAt       *time.Time `json:"locked_at,omitempty"`
	LockedUntil    *time.Time `json:"locked_until,omitempty"` // When lockout expires (for queries)
	UnlockedAt     *time.Time `json:"unlocked_at,omitempty"`
	LockReason     string     `gorm:"type:varchar(100)" json:"lock_reason,omitempty"`

	// Auto-unlock
	AutoUnlockAt *time.Time `json:"auto_unlock_at,omitempty"` // 30 min progressive lockout

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (AccountLockout) TableName() string {
	return "account_lockouts"
}

func (l *AccountLockout) BeforeCreate(tx *gorm.DB) error {
	if l.ID == uuid.Nil {
		l.ID = uuid.New()
	}
	return nil
}

// IsLocked checks if account is currently locked
func (l *AccountLockout) IsLocked() bool {
	if l.LockedAt == nil {
		return false
	}
	if l.UnlockedAt != nil {
		return false
	}
	if l.AutoUnlockAt != nil && time.Now().After(*l.AutoUnlockAt) {
		return false
	}
	return true
}

// RecordFailedAttempt increments failure count and may trigger lockout
func (l *AccountLockout) RecordFailedAttempt() {
	l.FailedAttempts++

	// Progressive lockout: 5 attempts = locked
	if l.FailedAttempts >= 5 {
		now := time.Now()
		l.LockedAt = &now
		l.LockReason = "Too many failed attempts"

		// Progressive unlock time: 30 min * (attempts - 4)
		// 5 attempts = 30 min, 6 = 60 min, etc.
		lockDuration := time.Duration(l.FailedAttempts-4) * 30 * time.Minute
		autoUnlock := now.Add(lockDuration)
		l.AutoUnlockAt = &autoUnlock
	}
}

// ResetOnSuccess resets counter on successful login
func (l *AccountLockout) ResetOnSuccess() {
	l.FailedAttempts = 0
	l.LockedAt = nil
	l.UnlockedAt = nil
	l.AutoUnlockAt = nil
	l.LockReason = ""
}
