package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/security"
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
		sec.POST("/mfa/setup", setupMFA)
		sec.POST("/mfa/verify", verifyMFASetup)
		sec.POST("/mfa/disable", disableMFA)

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
}

// ==================== MFA Endpoints ====================

// @Summary Get MFA status
// @Tags security
// @Produce json
// @Success 200 {object} gin.H
// @Router /v1/security/mfa/status [get]
func getMFAStatus(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var settings models.UserSettings
	if err := db.DB.Where("user_id = ?", userID).First(&settings).Error; err != nil {
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
	QRCodeURL   string   `json:"qr_code_url"`
	BackupCodes []string `json:"backup_codes"`
}

// @Summary Setup MFA
// @Tags security
// @Produce json
// @Success 200 {object} MFASetupResponse
// @Router /v1/security/mfa/setup [post]
func setupMFA(c *gin.Context) {
	userID := c.MustGet("user_id").(uuid.UUID)

	// Get user
	var user models.User
	if err := db.DB.Where("id = ?", userID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Generate secret
	secret, err := mfaService.GenerateSecret()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate secret"})
		return
	}

	// Generate backup codes
	codes, hashedCodes, err := mfaService.GenerateBackupCodes(8)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate backup codes"})
		return
	}

	// Save to settings (not yet enabled)
	hashedJSON, _ := json.Marshal(hashedCodes)

	var settings models.UserSettings
	if err := db.DB.Where("user_id = ?", userID).First(&settings).Error; err != nil {
		settings = models.UserSettings{UserID: userID}
	}

	settings.TwoFactorSecret = secret
	settings.TwoFactorBackupCodes = string(hashedJSON)
	// Don't enable yet - must verify first

	if settings.ID == uuid.Nil {
		db.DB.Create(&settings)
	} else {
		db.DB.Save(&settings)
	}

	// Generate QR code URL
	qrURL := mfaService.GenerateQRCodeURL(user.Email, secret)

	c.JSON(http.StatusOK, MFASetupResponse{
		Secret:      secret,
		QRCodeURL:   qrURL,
		BackupCodes: codes,
	})
}

// @Summary Verify MFA setup with code
// @Tags security
// @Accept json
// @Produce json
// @Param request body struct{Code string} true "TOTP code"
// @Success 200 {object} gin.H
// @Router /v1/security/mfa/verify [post]
func verifyMFASetup(c *gin.Context) {
	userID := c.MustGet("user_id").(uuid.UUID)

	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var settings models.UserSettings
	if err := db.DB.Where("user_id = ?", userID).First(&settings).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "MFA not setup"})
		return
	}

	if settings.TwoFactorSecret == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "MFA not setup"})
		return
	}

	// Verify the code
	if !mfaService.VerifyTOTP(settings.TwoFactorSecret, req.Code) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid TOTP code"})
		return
	}

	// Enable MFA
	now := time.Now()
	settings.TwoFactorEnabled = true
	settings.TwoFactorVerifiedAt = &now
	db.DB.Save(&settings)

	c.JSON(http.StatusOK, gin.H{
		"message":     "MFA enabled successfully",
		"enabled":     true,
		"verified_at": now,
	})
}

// @Summary Disable MFA
// @Tags security
// @Accept json
// @Produce json
// @Param request body struct{Code string} true "TOTP or backup code"
// @Success 200 {object} gin.H
// @Router /v1/security/mfa/disable [post]
func disableMFA(c *gin.Context) {
	userID := c.MustGet("user_id").(uuid.UUID)

	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var settings models.UserSettings
	if err := db.DB.Where("user_id = ?", userID).First(&settings).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "MFA not enabled"})
		return
	}

	// Verify with TOTP or backup code
	valid := mfaService.VerifyTOTP(settings.TwoFactorSecret, req.Code)

	if !valid {
		// Try backup codes
		var hashedCodes []string
		json.Unmarshal([]byte(settings.TwoFactorBackupCodes), &hashedCodes)
		valid, _ = mfaService.VerifyBackupCode(req.Code, hashedCodes)
	}

	if !valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid code"})
		return
	}

	// Disable MFA
	settings.TwoFactorEnabled = false
	settings.TwoFactorSecret = ""
	settings.TwoFactorBackupCodes = ""
	settings.TwoFactorVerifiedAt = nil
	db.DB.Save(&settings)

	c.JSON(http.StatusOK, gin.H{
		"message": "MFA disabled successfully",
		"enabled": false,
	})
}

// ==================== Session Endpoints ====================

// @Summary Get active sessions
// @Tags security
// @Produce json
// @Success 200 {array} models.UserSession
// @Router /v1/security/sessions [get]
func getActiveSessions(c *gin.Context) {
	userID := c.MustGet("user_id").(uuid.UUID)

	sessions, err := sessionService.GetActiveSessions(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get sessions"})
		return
	}

	// Mark current session
	currentIP := c.ClientIP()
	for i := range sessions {
		if sessions[i].IPAddress == currentIP {
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
	userID := c.MustGet("user_id").(uuid.UUID)
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

	if err := sessionService.RevokeSession(sessionUUID, "User requested"); err != nil {
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
	userID := c.MustGet("user_id").(uuid.UUID)

	if err := sessionService.RevokeAllSessions(userID, "User requested logout from all devices"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke sessions"})
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
	userID := c.MustGet("user_id").(uuid.UUID)

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
	userID := c.MustGet("user_id").(uuid.UUID)

	var req struct {
		SessionTimeout         *int    `json:"session_timeout"`
		MaxConcurrentSessions  *int    `json:"max_concurrent_sessions"`
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
		settings = models.UserSettings{UserID: userID}
		db.DB.Create(&settings)
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

	db.DB.Save(&settings)
	c.JSON(http.StatusOK, settings)
}

// ==================== Login Attempts ====================

// @Summary Get recent login attempts
// @Tags security
// @Produce json
// @Success 200 {array} models.LoginAttempt
// @Router /v1/security/attempts [get]
func getLoginAttempts(c *gin.Context) {
	userID := c.MustGet("user_id").(uuid.UUID)

	// Get user's wallet/address
	var user models.User
	if err := db.DB.Where("id = ?", userID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Find attempts by wallet address
	var attempts []models.LoginAttempt
	var identifier string
	if user.WalletAddress != nil {
		identifier = *user.WalletAddress
	}

	if identifier != "" {
		db.DB.Where("identifier = ?", identifier).
			Order("created_at DESC").
			Limit(20).
			Find(&attempts)
	}

	c.JSON(http.StatusOK, gin.H{"attempts": attempts})
}
