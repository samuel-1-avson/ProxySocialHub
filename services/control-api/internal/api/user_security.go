package api

import (
	"encoding/json"
	"errors"
	"gorm.io/gorm/clause"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/security"
	"gorm.io/gorm"
)

var (
	mfaService     *security.MFAService
	sessionService *security.SessionService
	lockoutService *security.LockoutService
)

func init() {
	mfaService = security.NewMFAService()
	sessionService = security.NewSessionService()
	lockoutService = security.NewLockoutService()
}

// RegisterSecurityRoutes registers security-related endpoints
func RegisterSecurityRoutes(r *gin.RouterGroup) {
	sec := r.Group("/security")
	{
		// MFA/TOTP
		sec.GET("/mfa/status", getMFAStatus)
		sec.POST("/mfa/setup", StrictRateLimit(), setupMFA)
		sec.POST("/mfa/verify", StrictRateLimit(), verifyMFASetup)
		sec.POST("/mfa/disable", StrictRateLimit(), disableMFA)

		// Sessions
		sec.GET("/sessions", getActiveSessions)
		sec.DELETE("/sessions/:id", revokeSession)
		sec.DELETE("/sessions", revokeAllSessions)

		// Settings
		sec.GET("/settings", getSecuritySettings)
		sec.PUT("/settings", updateSecuritySettings)

		// Login Attempts
		sec.GET("/attempts", getLoginAttempts)
	}

	// Aligned 2FA endpoints for frontend compatibility
	twoFA := r.Group("/2fa")
	{
		twoFA.GET("/backup-codes", getBackupCodes)
		twoFA.POST("/setup", StrictRateLimit(), setupMFA)
		twoFA.POST("/enable", StrictRateLimit(), verifyMFASetup)
		twoFA.POST("/disable", StrictRateLimit(), disableMFA)
		twoFA.POST("/backup-codes/regenerate", StrictRateLimit(), regenerateBackupCodes)
	}
}

// ==================== MFA Endpoints ====================

// @Summary Get MFA status
// @Tags security
// @Produce json
// @Success 200 {object} gin.H
// @Router /v1/security/mfa/status [get]
func getMFAStatus(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var settings models.UserSettings
	if err := db.DB.Where("user_id = ?", userID).First(&settings).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(503, gin.H{"error": "Security settings unavailable"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"enabled":     false,
			"verified_at": nil,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"enabled":     settings.TwoFactorEnabled,
		"verified_at": settings.TwoFactorVerifiedAt,
	})
}

// MFASetupResponse for setup endpoint
type MFASetupResponse struct {
	Secret      string   `json:"secret"`
	QRCodeURL   string   `json:"qr_code_url"` // Keep for compatibility
	QRCode      string   `json:"qr_code"`     // Legacy field; render QR locally from OTPAuthURL.
	OTPAuthURL  string   `json:"otpauth_url"` // Added for frontend
	BackupCodes []string `json:"backup_codes,omitempty"`
}

// @Summary Setup MFA
// @Tags security
// @Produce json
// @Success 200 {object} MFASetupResponse
// @Router /v1/security/mfa/setup [post]
func setupMFA(c *gin.Context) {
	uid, ok := GetUserID(c)
	if !ok {
		c.JSON(401, gin.H{"error": "Authentication required"})
		return
	}
	var user models.User
	if db.DB.First(&user, "id = ?", uid).Error != nil {
		c.JSON(404, gin.H{"error": "Account unavailable"})
		return
	}
	secret, err := mfaService.GenerateSecret()
	if err != nil {
		c.JSON(503, gin.H{"error": "MFA setup unavailable"})
		return
	}
	enabled := false
	err = db.DB.Transaction(func(tx *gorm.DB) error {
		var account models.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&account, "id = ?", uid).Error; err != nil {
			return err
		}
		var settings models.UserSettings
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", uid).First(&settings).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if settings.TwoFactorEnabled {
			enabled = true
			return nil
		}
		if settings.ID == uuid.Nil {
			settings = models.UserSettings{UserID: uid}
		}
		settings.TwoFactorSecret = secret
		settings.TwoFactorBackupCodes = ""
		settings.TwoFactorVerifiedAt = nil
		settings.LastTOTPHash = ""
		settings.LastTOTPAt = nil
		return tx.Save(&settings).Error
	})
	if err != nil {
		c.JSON(503, gin.H{"error": "Cannot save MFA setup"})
		return
	}
	if enabled {
		c.JSON(409, gin.H{"error": "Verify and disable the existing factor before replacing it"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, MFASetupResponse{Secret: secret, OTPAuthURL: mfaService.GenerateQRCodeURL("Account "+uid.String()[:8], secret)})
}

// @Summary Verify MFA setup with code
// @Tags security
// @Accept json
// @Produce json
// @Param request body struct{Code string} true "TOTP code"
// @Success 200 {object} gin.H
// @Router /v1/security/mfa/verify [post]
func verifyMFASetup(c *gin.Context) {
	uid, ok := GetUserID(c)
	if !ok {
		c.JSON(401, gin.H{"error": "Authentication required"})
		return
	}
	var req struct {
		Code string `json:"code" binding:"required,len=6"`
	}
	if c.ShouldBindJSON(&req) != nil {
		c.JSON(400, gin.H{"error": "A six-digit code is required"})
		return
	}
	var codes []string
	var verified time.Time
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		var settings models.UserSettings
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", uid).First(&settings).Error; err != nil {
			return err
		}
		if settings.TwoFactorEnabled || settings.TwoFactorSecret == "" || !verifyFactor(&settings, req.Code) {
			return errors.New("MFA setup unavailable or invalid code")
		}
		plain, hashes, err := mfaService.GenerateBackupCodes(8)
		if err != nil {
			return err
		}
		codes = plain
		data, err := json.Marshal(hashes)
		if err != nil {
			return err
		}
		verified = time.Now()
		settings.TwoFactorEnabled = true
		settings.TwoFactorVerifiedAt = &verified
		settings.TwoFactorBackupCodes = string(data)
		return tx.Save(&settings).Error
	})
	if err != nil {
		c.JSON(400, gin.H{"error": "MFA setup unavailable or invalid code"})
		return
	}
	RecordAuditLog(c, models.AuditAuthMFAEnabled, models.AuditSeverityInfo, &uid, "user", uid.String(), "MFA enabled", true)
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"enabled": true, "verified_at": verified, "backup_codes": codes})
}

// @Summary Disable MFA
// @Tags security
// @Accept json
// @Produce json
// @Param request body struct{Code string} true "TOTP or backup code"
// @Success 200 {object} gin.H
// @Router /v1/security/mfa/disable [post]
func getBackupCodes(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var settings models.UserSettings
	if err := db.DB.Where("user_id = ?", userID).First(&settings).Error; err != nil || !settings.TwoFactorEnabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "MFA not enabled"})
		return
	}

	var codes []string
	if settings.TwoFactorBackupCodes != "" {
		json.Unmarshal([]byte(settings.TwoFactorBackupCodes), &codes)
	}

	c.JSON(http.StatusOK, gin.H{
		"remaining_codes": len(codes),
	})
}

// regenerateBackupCodes regenerates fresh backup codes for the user
func regenerateBackupCodes(c *gin.Context) {
	verifiedSecurityChange(c, func(settings *models.UserSettings) (gin.H, error) {
		codes, hashes, err := mfaService.GenerateBackupCodes(8)
		if err != nil {
			return nil, err
		}
		data, err := json.Marshal(hashes)
		if err != nil {
			return nil, err
		}
		settings.TwoFactorBackupCodes = string(data)
		return gin.H{"backup_codes": codes}, nil
	})
}

func disableMFA(c *gin.Context) {
	verifiedSecurityChange(c, func(settings *models.UserSettings) (gin.H, error) {
		settings.TwoFactorEnabled = false
		settings.TwoFactorSecret = ""
		settings.TwoFactorBackupCodes = ""
		settings.TwoFactorVerifiedAt = nil
		settings.LastTOTPHash = ""
		settings.LastTOTPAt = nil
		return gin.H{"enabled": false, "message": "MFA disabled"}, nil
	})
}

func verifiedSecurityChange(c *gin.Context, change func(*models.UserSettings) (gin.H, error)) {
	uid, ok := GetUserID(c)
	if !ok {
		c.JSON(401, gin.H{"error": "Authentication required"})
		return
	}
	var req map[string]string
	if c.ShouldBindJSON(&req) != nil || len(req["code"]) < 6 || len(req["code"]) > 32 {
		c.JSON(400, gin.H{"error": "Current authenticator or backup code required"})
		return
	}
	var result gin.H
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		var settings models.UserSettings
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", uid).First(&settings).Error; err != nil {
			return err
		}
		if !settings.TwoFactorEnabled || !verifyFactor(&settings, req["code"]) {
			return errors.New("verification failed")
		}
		var err error
		result, err = change(&settings)
		if err != nil {
			return err
		}
		return tx.Save(&settings).Error
	})
	if err != nil {
		c.JSON(403, gin.H{"error": "Verification failed or MFA is not enabled"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, result)
}

// ==================== Session Endpoints ====================

// @Summary Get active sessions
// @Tags security
// @Produce json
// @Success 200 {array} models.UserSession
// @Router /v1/security/sessions [get]
func getActiveSessions(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	sessions, err := sessionService.GetActiveSessions(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get sessions"})
		return
	}

	// Mark current session
	currentFamily := c.GetString("auth_session_id")
	for i := range sessions {
		if sessions[i].TokenFamily == currentFamily {
			// This is likely the current session
			sessions[i].DeviceType = sessions[i].DeviceType + " (current)"
		}
	}

	c.JSON(http.StatusOK, gin.H{"sessions": sessions, "count": len(sessions)})
}

// @Summary Revoke a session
// @Tags security
// @Param id path string true "Session ID"
// @Produce json
// @Success 200 {object} gin.H
// @Router /v1/security/sessions/{id} [delete]
func revokeSession(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	sessionID := c.Param("id")

	sessionUUID, err := uuid.Parse(sessionID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session ID"})
		return
	}

	// Verify session belongs to user
	var session models.UserSession
	if err := db.DB.Where("id = ? AND user_id = ?", sessionUUID, userID).First(&session).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}

	if err := db.DB.Transaction(func(tx *gorm.DB) error { return revokeAuthFamily(tx, session.TokenFamily) }); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke session"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Session revoked"})
}

// @Summary Revoke all sessions
// @Tags security
// @Produce json
// @Success 200 {object} gin.H
// @Router /v1/security/sessions [delete]
func revokeAllSessions(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		if err := tx.Model(&models.UserSession{}).Where("user_id = ?", userID).Updates(map[string]interface{}{"is_active": false, "revoked_at": now, "revoke_reason": "User requested logout from all devices"}).Error; err != nil {
			return err
		}
		return tx.Model(&models.RefreshTokenFamily{}).Where("user_id = ?", userID).Updates(map[string]interface{}{"is_current": false, "revoked_at": now}).Error
	}); err != nil {
		c.JSON(503, gin.H{"error": "Failed to revoke sessions"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "All sessions revoked"})
}

// ==================== Settings Endpoints ====================

// @Summary Get security settings
// @Tags security
// @Produce json
// @Success 200 {object} models.UserSettings
// @Router /v1/security/settings [get]
func getSecuritySettings(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var settings models.UserSettings
	if err := db.DB.Where("user_id = ?", userID).First(&settings).Error; err != nil {
		// Return defaults
		c.JSON(http.StatusOK, models.UserSettings{
			UserID:                userID,
			SessionTimeout:        1440,
			MaxConcurrentSessions: 5,
			NotifyOnNewLogin:      true,
			PreferredLanguage:     "en",
			Theme:                 "system",
			Timezone:              "UTC",
		})
		return
	}

	c.JSON(http.StatusOK, settings)
}

// @Summary Update security settings
// @Tags security
// @Accept json
// @Produce json
// @Param request body models.UserSettings true "Settings"
// @Success 200 {object} models.UserSettings
// @Router /v1/security/settings [put]
func updateSecuritySettings(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req struct {
		SessionTimeout         *int    `json:"session_timeout" binding:"omitempty,gte=5,lte=43200"`
		MaxConcurrentSessions  *int    `json:"max_concurrent_sessions" binding:"omitempty,gte=1,lte=20"`
		NotifyOnNewLogin       *bool   `json:"notify_on_new_login"`
		NotifyOnPasswordChange *bool   `json:"notify_on_password_change"`
		PreferredLanguage      *string `json:"preferred_language"`
		Theme                  *string `json:"theme"`
		Timezone               *string `json:"timezone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var settings models.UserSettings
	if err := db.DB.Where("user_id = ?", userID).First(&settings).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(503, gin.H{"error": "Security settings unavailable"})
			return
		}
		settings = models.UserSettings{UserID: userID}
	}

	// Update fields if provided
	if req.SessionTimeout != nil {
		settings.SessionTimeout = *req.SessionTimeout
	}
	if req.MaxConcurrentSessions != nil {
		settings.MaxConcurrentSessions = *req.MaxConcurrentSessions
	}
	if req.NotifyOnNewLogin != nil {
		settings.NotifyOnNewLogin = *req.NotifyOnNewLogin
	}
	if req.NotifyOnPasswordChange != nil {
		settings.NotifyOnPasswordChange = *req.NotifyOnPasswordChange
	}
	if req.PreferredLanguage != nil {
		settings.PreferredLanguage = *req.PreferredLanguage
	}
	if req.Theme != nil {
		settings.Theme = *req.Theme
	}
	if req.Timezone != nil {
		settings.Timezone = *req.Timezone
	}

	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&settings).Error; err != nil {
			return err
		}
		if req.SessionTimeout != nil {
			deadline := time.Now().Add(time.Duration(settings.SessionTimeout) * time.Minute)
			if err := tx.Model(&models.UserSession{}).Where("user_id = ? AND expires_at > ?", userID, deadline).Update("expires_at", deadline).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.RefreshTokenFamily{}).Where("user_id = ? AND expires_at > ?", userID, deadline).Update("expires_at", deadline).Error; err != nil {
				return err
			}
		}
		if req.MaxConcurrentSessions != nil {
			var devices []models.UserSession
			if err := tx.Where("user_id = ? AND is_active = ?", userID, true).Order("created_at DESC,id DESC").Find(&devices).Error; err != nil {
				return err
			}
			for i := settings.MaxConcurrentSessions; i < len(devices); i++ {
				if err := revokeAuthFamily(tx, devices[i].TokenFamily); err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		c.JSON(503, gin.H{"error": "Cannot save security settings"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, settings)
}

// ==================== Login Attempts ====================

// @Summary Get recent login attempts
// @Tags security
// @Produce json
// @Success 200 {array} models.LoginAttempt
// @Router /v1/security/attempts [get]
func getLoginAttempts(c *gin.Context) {
	uid, ok := GetUserID(c)
	if !ok {
		c.JSON(401, gin.H{"error": "Authentication required"})
		return
	}
	var logs []models.AuditLog
	if err := db.DB.Where("actor_id = ? AND event_type IN ?", uid, []models.AuditEventType{models.AuditAuthLogin, models.AuditAuthLoginFailed}).Order("created_at DESC").Limit(50).Find(&logs).Error; err != nil {
		c.JSON(503, gin.H{"error": "Security history unavailable"})
		return
	}
	attempts := make([]models.LoginAttempt, 0, len(logs))
	for _, event := range logs {
		attempts = append(attempts, models.LoginAttempt{ID: event.ID, Identifier: uid.String(), IdentifierType: "account", Success: event.Success, FailureReason: event.Description, IPAddress: event.IPAddress, UserAgent: event.UserAgent, CreatedAt: event.CreatedAt})
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"attempts": attempts})
}
