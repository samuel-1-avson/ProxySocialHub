package security

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// MFAService handles TOTP-based multi-factor authentication
type MFAService struct {
	issuer string
	digits int
	period int
}

// NewMFAService creates a new MFA service
func NewMFAService() *MFAService {
	return &MFAService{
		issuer: "ProxyHubb",
		digits: 6,
		period: 30, // 30 second codes
	}
}

// GenerateSecret generates a new TOTP secret
func (m *MFAService) GenerateSecret() (string, error) {
	secret := make([]byte, 20)
	_, err := rand.Read(secret)
	if err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secret), nil
}

// GenerateQRCodeURL generates a URL for QR code generation
func (m *MFAService) GenerateQRCodeURL(userEmail, secret string) string {
	label := url.QueryEscape(fmt.Sprintf("%s:%s", m.issuer, userEmail))
	params := url.Values{}
	params.Set("secret", secret)
	params.Set("issuer", m.issuer)
	params.Set("algorithm", "SHA1")
	params.Set("digits", fmt.Sprintf("%d", m.digits))
	params.Set("period", fmt.Sprintf("%d", m.period))

	return fmt.Sprintf("otpauth://totp/%s?%s", label, params.Encode())
}

// VerifyTOTP verifies a TOTP code
func (m *MFAService) VerifyTOTP(secret, code string) bool {
	// Decode the secret
	secretBytes, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if err != nil {
		return false
	}

	// Get current time counter
	counter := time.Now().Unix() / int64(m.period)

	// Check current code and one period before/after (for clock drift)
	for i := int64(-1); i <= 1; i++ {
		expectedCode := m.generateCode(secretBytes, counter+i)
		if expectedCode == code {
			return true
		}
	}

	return false
}

// generateCode generates a TOTP code for a given counter
func (m *MFAService) generateCode(secret []byte, counter int64) string {
	// Convert counter to bytes
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, uint64(counter))

	// Calculate HMAC-SHA1
	mac := hmac.New(sha1.New, secret)
	mac.Write(buf)
	hash := mac.Sum(nil)

	// Dynamic truncation
	offset := hash[len(hash)-1] & 0x0f
	truncated := binary.BigEndian.Uint32(hash[offset:offset+4]) & 0x7fffffff

	// Get the last 6 digits
	code := truncated % 1000000
	return fmt.Sprintf("%06d", code)
}

// GenerateBackupCodes generates recovery codes
func (m *MFAService) GenerateBackupCodes(count int) ([]string, []string, error) {
	codes := make([]string, count)
	hashedCodes := make([]string, count)

	for i := 0; i < count; i++ {
		// Generate 8 character code
		buf := make([]byte, 4)
		_, err := rand.Read(buf)
		if err != nil {
			return nil, nil, err
		}
		codes[i] = fmt.Sprintf("%08x", buf)

		// Hash the code for storage
		hash := sha256.Sum256([]byte(codes[i]))
		hashedCodes[i] = hex.EncodeToString(hash[:])
	}

	return codes, hashedCodes, nil
}

// VerifyBackupCode checks if a backup code is valid
func (m *MFAService) VerifyBackupCode(code string, hashedCodes []string) (bool, int) {
	hash := sha256.Sum256([]byte(code))
	codeHash := hex.EncodeToString(hash[:])

	for i, hashed := range hashedCodes {
		if hashed == codeHash {
			return true, i
		}
	}
	return false, -1
}

// SessionService manages user sessions
type SessionService struct {
	db *gorm.DB
}

// NewSessionService creates a new session service
func NewSessionService() *SessionService {
	return &SessionService{}
}

func (s *SessionService) dbHandle() (*gorm.DB, error) {
	if s.db != nil {
		return s.db, nil
	}

	if db.DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	s.db = db.DB
	return s.db, nil
}

// CreateSession creates a new user session
func (s *SessionService) CreateSession(userID uuid.UUID, ip, userAgent string, expiresIn time.Duration) (*models.UserSession, string, error) {
	dbHandle, err := s.dbHandle()
	if err != nil {
		return nil, "", err
	}

	// Generate refresh token
	tokenBytes := make([]byte, 32)
	_, err = rand.Read(tokenBytes)
	if err != nil {
		return nil, "", err
	}
	refreshToken := hex.EncodeToString(tokenBytes)

	// Generate token family (for rotation tracking)
	familyBytes := make([]byte, 16)
	rand.Read(familyBytes)
	tokenFamily := hex.EncodeToString(familyBytes)

	// Hash refresh token for storage
	tokenHash := sha256.Sum256([]byte(refreshToken))

	// Parse user agent for device info
	deviceInfo := parseUserAgent(userAgent)

	// Create fingerprint
	fingerprint := generateFingerprint(ip, userAgent)

	session := &models.UserSession{
		UserID:       userID,
		RefreshToken: hex.EncodeToString(tokenHash[:]),
		TokenFamily:  tokenFamily,
		IPAddress:    ip,
		UserAgent:    userAgent,
		Fingerprint:  fingerprint,
		DeviceType:   deviceInfo.DeviceType,
		Browser:      deviceInfo.Browser,
		OS:           deviceInfo.OS,
		IsActive:     true,
		ExpiresAt:    time.Now().Add(expiresIn),
	}

	if err := dbHandle.Create(session).Error; err != nil {
		return nil, "", err
	}

	// Check session limit
	go s.enforceSessionLimit(userID)

	return session, refreshToken, nil
}

// ValidateRefreshToken validates a refresh token and returns the session
func (s *SessionService) ValidateRefreshToken(refreshToken string) (*models.UserSession, error) {
	dbHandle, err := s.dbHandle()
	if err != nil {
		return nil, err
	}

	tokenHash := sha256.Sum256([]byte(refreshToken))
	tokenHashStr := hex.EncodeToString(tokenHash[:])

	var session models.UserSession
	if err := dbHandle.Where("refresh_token = ? AND is_active = true AND expires_at > ?",
		tokenHashStr, time.Now()).First(&session).Error; err != nil {
		return nil, err
	}

	return &session, nil
}

// RotateRefreshToken rotates a refresh token (invalidates old, creates new)
func (s *SessionService) RotateRefreshToken(session *models.UserSession) (string, error) {
	dbHandle, err := s.dbHandle()
	if err != nil {
		return "", err
	}

	// Generate new refresh token
	tokenBytes := make([]byte, 32)
	_, err = rand.Read(tokenBytes)
	if err != nil {
		return "", err
	}
	newRefreshToken := hex.EncodeToString(tokenBytes)

	// Hash for storage
	tokenHash := sha256.Sum256([]byte(newRefreshToken))

	// Update session with new token
	session.RefreshToken = hex.EncodeToString(tokenHash[:])
	session.LastActiveAt = time.Now()

	if err := dbHandle.Save(session).Error; err != nil {
		return "", err
	}

	return newRefreshToken, nil
}

// RevokeSession revokes a specific session
func (s *SessionService) RevokeSession(sessionID uuid.UUID, reason string) error {
	dbHandle, err := s.dbHandle()
	if err != nil {
		return err
	}

	return dbHandle.Model(&models.UserSession{}).Where("id = ?", sessionID).Updates(map[string]interface{}{
		"is_active":     false,
		"revoked_at":    time.Now(),
		"revoke_reason": reason,
	}).Error
}

// RevokeAllSessions revokes all sessions for a user
func (s *SessionService) RevokeAllSessions(userID uuid.UUID, reason string) error {
	dbHandle, err := s.dbHandle()
	if err != nil {
		return err
	}

	return dbHandle.Model(&models.UserSession{}).Where("user_id = ? AND is_active = true", userID).Updates(map[string]interface{}{
		"is_active":     false,
		"revoked_at":    time.Now(),
		"revoke_reason": reason,
	}).Error
}

// RevokeTokenFamily revokes all tokens in a family (use when token reuse detected)
func (s *SessionService) RevokeTokenFamily(tokenFamily string) error {
	log.Printf("[SECURITY] Token family revoked due to potential theft: %s", tokenFamily[:8])
	dbHandle, err := s.dbHandle()
	if err != nil {
		return err
	}

	return dbHandle.Model(&models.UserSession{}).Where("token_family = ?", tokenFamily).Updates(map[string]interface{}{
		"is_active":     false,
		"revoked_at":    time.Now(),
		"revoke_reason": "Token reuse detected - potential theft",
	}).Error
}

// GetActiveSessions returns all active sessions for a user
func (s *SessionService) GetActiveSessions(userID uuid.UUID) ([]models.UserSession, error) {
	dbHandle, err := s.dbHandle()
	if err != nil {
		return nil, err
	}

	var sessions []models.UserSession
	err = dbHandle.Where("user_id = ? AND is_active = true AND expires_at > ?", userID, time.Now()).
		Order("last_active_at DESC").Find(&sessions).Error
	return sessions, err
}

// enforceSessionLimit removes oldest sessions if limit exceeded
func (s *SessionService) enforceSessionLimit(userID uuid.UUID) {
	dbHandle, err := s.dbHandle()
	if err != nil {
		log.Printf("[SECURITY] unable to enforce session limit: %v", err)
		return
	}

	// Get user settings for max sessions
	var settings models.UserSettings
	if err := dbHandle.Where("user_id = ?", userID).First(&settings).Error; err != nil {
		settings.MaxConcurrentSessions = 5 // Default
	}

	// Count active sessions
	var count int64
	dbHandle.Model(&models.UserSession{}).Where("user_id = ? AND is_active = true", userID).Count(&count)

	if count > int64(settings.MaxConcurrentSessions) {
		// Revoke oldest sessions
		var oldestSessions []models.UserSession
		dbHandle.Where("user_id = ? AND is_active = true", userID).
			Order("last_active_at ASC").
			Limit(int(count) - settings.MaxConcurrentSessions).
			Find(&oldestSessions)

		for _, session := range oldestSessions {
			session.Revoke("Session limit exceeded")
			s.db.Save(&session)
		}
	}
}

// LockoutService manages account lockouts
type LockoutService struct {
	db             *gorm.DB
	maxAttempts    int
	lockoutMinutes int
}

// NewLockoutService creates a new lockout service
func NewLockoutService() *LockoutService {
	return &LockoutService{
		db:             db.DB,
		maxAttempts:    5,
		lockoutMinutes: 30,
	}
}

// CheckLockout checks if an identifier is locked out
func (l *LockoutService) CheckLockout(identifier, identifierType string) (bool, *time.Time) {
	var lockout models.AccountLockout
	if err := l.db.Where("identifier = ? AND identifier_type = ?", identifier, identifierType).First(&lockout).Error; err != nil {
		return false, nil // No lockout record
	}

	if lockout.IsLocked() {
		return true, lockout.AutoUnlockAt
	}

	return false, nil
}

// RecordAttempt records a login attempt
func (l *LockoutService) RecordAttempt(identifier, identifierType, ip, userAgent string, success bool, failureReason string) error {
	// Record the attempt
	attempt := models.LoginAttempt{
		Identifier:     identifier,
		IdentifierType: identifierType,
		Success:        success,
		FailureReason:  failureReason,
		IPAddress:      ip,
		UserAgent:      userAgent,
	}
	l.db.Create(&attempt)

	// Update lockout record
	var lockout models.AccountLockout
	err := l.db.Where("identifier = ? AND identifier_type = ?", identifier, identifierType).First(&lockout).Error

	if err != nil {
		// Create new lockout record
		lockout = models.AccountLockout{
			Identifier:     identifier,
			IdentifierType: identifierType,
		}
	}

	if success {
		lockout.ResetOnSuccess()
	} else {
		lockout.RecordFailedAttempt()
	}

	if lockout.ID == uuid.Nil {
		return l.db.Create(&lockout).Error
	}
	return l.db.Save(&lockout).Error
}

// Helper functions

type DeviceInfo struct {
	DeviceType string
	Browser    string
	OS         string
}

func parseUserAgent(userAgent string) DeviceInfo {
	info := DeviceInfo{
		DeviceType: "desktop",
		Browser:    "Unknown",
		OS:         "Unknown",
	}

	ua := strings.ToLower(userAgent)

	// Detect device type
	if strings.Contains(ua, "mobile") || strings.Contains(ua, "android") {
		info.DeviceType = "mobile"
	} else if strings.Contains(ua, "tablet") || strings.Contains(ua, "ipad") {
		info.DeviceType = "tablet"
	}

	// Detect browser
	switch {
	case strings.Contains(ua, "chrome") && !strings.Contains(ua, "edge"):
		info.Browser = "Chrome"
	case strings.Contains(ua, "firefox"):
		info.Browser = "Firefox"
	case strings.Contains(ua, "safari") && !strings.Contains(ua, "chrome"):
		info.Browser = "Safari"
	case strings.Contains(ua, "edge"):
		info.Browser = "Edge"
	}

	// Detect OS
	switch {
	case strings.Contains(ua, "windows"):
		info.OS = "Windows"
	case strings.Contains(ua, "mac os"):
		info.OS = "macOS"
	case strings.Contains(ua, "linux"):
		info.OS = "Linux"
	case strings.Contains(ua, "android"):
		info.OS = "Android"
	case strings.Contains(ua, "iphone") || strings.Contains(ua, "ipad"):
		info.OS = "iOS"
	}

	return info
}

func generateFingerprint(ip, userAgent string) string {
	data := bytes.Join([][]byte{
		[]byte(ip),
		[]byte(userAgent),
	}, []byte(":"))
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}
