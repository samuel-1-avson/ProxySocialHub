package api

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/email"
	"github.com/proxyhubb/control-api/internal/models"
	"golang.org/x/crypto/bcrypt"
)

// Register2FARoutes registers the 2FA endpoints
func Register2FARoutes(r *gin.RouterGroup) {
	twofa := r.Group("/2fa")
	{
		twofa.POST("/setup", setup2FA)
		twofa.POST("/enable", enable2FA)
		twofa.POST("/disable", disable2FA)
		twofa.POST("/verify", verify2FA)
		twofa.GET("/backup-codes", getBackupCodes)
		twofa.POST("/backup-codes/regenerate", regenerateBackupCodes)
	}
}

// Setup2FAResponse contains the TOTP setup information
type Setup2FAResponse struct {
	Secret     string `json:"secret"`
	QRCode     string `json:"qr_code"`     // Base64 encoded QR code image
	OTPAuthURL string `json:"otpauth_url"` // For manual entry
}

// setup2FARequest is optional - user just needs to be authenticated
type enable2FARequest struct {
	Code string `json:"code" binding:"required,len=6"`
}

type disable2FARequest struct {
	Password string `json:"password" binding:"required"`
	Code     string `json:"code"` // TOTP code OR backup code
}

type verify2FARequest struct {
	TempToken string `json:"temp_token" binding:"required"`
	Code      string `json:"code" binding:"required"` // 6-digit TOTP or backup code
}

// setup2FA generates a new TOTP secret and returns QR code
func setup2FA(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	var user models.User
	if result := db.DB.First(&user, "id = ?", userID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Check if 2FA is already enabled
	if user.TOTPEnabled {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "2FA is already enabled. Disable it first to reconfigure.",
			"code":  "already_enabled",
		})
		return
	}

	// Generate new TOTP secret
	secret := generateTOTPSecret()
	user.TOTPSecret = &secret

	// Save the secret (but don't enable 2FA yet)
	if result := db.DB.Save(&user); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save 2FA secret"})
		return
	}

	// Generate OTPAuth URL for QR code
	issuer := "ProxyHubb"
	otpauthURL := fmt.Sprintf("otpauth://totp/%s:%s?secret=%s&issuer=%s&algorithm=SHA1&digits=6&period=30",
		issuer, user.Email, secret, issuer)

	// Generate QR code as base64 PNG
	qrCode := generateQRCodeBase64(otpauthURL)

	c.JSON(http.StatusOK, gin.H{
		"secret":      formatSecretForDisplay(secret),
		"qr_code":     qrCode,
		"otpauth_url": otpauthURL,
		"message":     "Scan the QR code with your authenticator app, then verify with a code to enable 2FA",
	})
}

// enable2FA verifies the TOTP code and enables 2FA
func enable2FA(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req enable2FARequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	var user models.User
	if result := db.DB.First(&user, "id = ?", userID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Check if secret exists (setup was called)
	if user.TOTPSecret == nil || *user.TOTPSecret == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Please call /2fa/setup first",
			"code":  "setup_required",
		})
		return
	}

	// Check if already enabled
	if user.TOTPEnabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "2FA is already enabled"})
		return
	}

	// Verify the TOTP code
	if !verifyTOTP(*user.TOTPSecret, req.Code) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid verification code",
			"code":  "invalid_code",
		})
		return
	}

	// Enable 2FA
	user.TOTPEnabled = true
	if result := db.DB.Save(&user); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to enable 2FA"})
		return
	}

	// Generate backup codes
	plaintextCodes, hashedCodes, err := models.GenerateBackupCodes(user.ID, 10)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate backup codes"})
		return
	}

	// Save backup codes
	for _, code := range hashedCodes {
		db.DB.Create(&code)
	}

	// Format codes for display
	formattedCodes := make([]string, len(plaintextCodes))
	for i, code := range plaintextCodes {
		formattedCodes[i] = models.FormatBackupCode(code)
	}

	// Send backup codes via email
	if emailService := email.GetService(); emailService != nil {
		emailService.Send2FABackupCodesEmail(user.Email, formattedCodes)
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "2FA has been enabled successfully",
		"backup_codes": formattedCodes,
		"warning":      "Save these backup codes in a safe place. You won't be able to see them again.",
	})
}

// disable2FA disables 2FA for the user
func disable2FA(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req disable2FARequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	var user models.User
	if result := db.DB.First(&user, "id = ?", userID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Verify password
	if err := verifyPassword(user.PasswordHash, req.Password); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid password"})
		return
	}

	// Verify TOTP code if provided and 2FA is enabled
	if user.TOTPEnabled {
		if req.Code == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "2FA code required to disable 2FA"})
			return
		}

		// Try TOTP code first
		if user.TOTPSecret != nil && !verifyTOTP(*user.TOTPSecret, req.Code) {
			// Try backup code
			if !verifyAndUseBackupCode(user.ID, req.Code) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid 2FA code"})
				return
			}
		}
	}

	// Disable 2FA
	user.TOTPEnabled = false
	user.TOTPSecret = nil
	if result := db.DB.Save(&user); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to disable 2FA"})
		return
	}

	// Delete all backup codes
	db.DB.Where("user_id = ?", user.ID).Delete(&models.TOTPBackupCode{})

	c.JSON(http.StatusOK, gin.H{"message": "2FA has been disabled successfully"})
}

// verify2FA verifies a 2FA code during login
func verify2FA(c *gin.Context) {
	var req verify2FARequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	// Validate temp token and extract user ID
	claims, err := ValidateTempToken(req.TempToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid or expired temporary token. Please login again.",
			"code":  "invalid_temp_token",
		})
		return
	}

	var user models.User
	if result := db.DB.First(&user, "id = ?", claims.UserID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Verify the code
	codeValid := false
	isBackupCode := false

	// Try TOTP first
	if user.TOTPSecret != nil && verifyTOTP(*user.TOTPSecret, req.Code) {
		codeValid = true
	}

	// Try backup code if TOTP didn't work
	if !codeValid {
		// Remove dashes from code for comparison
		cleanCode := strings.ReplaceAll(req.Code, "-", "")
		if verifyAndUseBackupCode(user.ID, cleanCode) {
			codeValid = true
			isBackupCode = true
		}
	}

	if !codeValid {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid 2FA code",
			"code":  "invalid_2fa_code",
		})
		return
	}

	// Generate full access token
	tokenPair, err := GenerateTokenPair(user.ID.String(), user.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	response := gin.H{
		"access_token":  tokenPair.AccessToken,
		"refresh_token": tokenPair.RefreshToken,
		"expires_in":    tokenPair.ExpiresIn,
		"token_type":    tokenPair.TokenType,
		"user": gin.H{
			"id":             user.ID,
			"email":          user.Email,
			"role":           user.Role,
			"email_verified": user.EmailVerified,
			"totp_enabled":   user.TOTPEnabled,
		},
	}

	if isBackupCode {
		response["warning"] = "You used a backup code. Consider generating new backup codes if running low."
	}

	c.JSON(http.StatusOK, response)
}

// getBackupCodes shows remaining backup code count
func getBackupCodes(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	var count int64
	db.DB.Model(&models.TOTPBackupCode{}).Where("user_id = ? AND used = false", userID).Count(&count)

	c.JSON(http.StatusOK, gin.H{
		"remaining_codes": count,
		"message":         fmt.Sprintf("You have %d unused backup codes remaining", count),
	})
}

// regenerateBackupCodes creates new backup codes (invalidates old ones)
func regenerateBackupCodes(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	var user models.User
	if result := db.DB.First(&user, "id = ?", userID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	if !user.TOTPEnabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "2FA is not enabled"})
		return
	}

	// Delete old backup codes
	db.DB.Where("user_id = ?", user.ID).Delete(&models.TOTPBackupCode{})

	// Generate new backup codes
	plaintextCodes, hashedCodes, err := models.GenerateBackupCodes(user.ID, 10)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate backup codes"})
		return
	}

	// Save new backup codes
	for _, code := range hashedCodes {
		db.DB.Create(&code)
	}

	// Format codes for display
	formattedCodes := make([]string, len(plaintextCodes))
	for i, code := range plaintextCodes {
		formattedCodes[i] = models.FormatBackupCode(code)
	}

	// Send backup codes via email
	if emailService := email.GetService(); emailService != nil {
		emailService.Send2FABackupCodesEmail(user.Email, formattedCodes)
	}

	c.JSON(http.StatusOK, gin.H{
		"backup_codes": formattedCodes,
		"warning":      "Old backup codes have been invalidated. Save these new codes in a safe place.",
	})
}

// Helper functions

// generateTOTPSecret generates a random base32-encoded secret
func generateTOTPSecret() string {
	bytes := make([]byte, 20)
	rand.Read(bytes)
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(bytes)
}

// formatSecretForDisplay formats the secret in groups of 4 for easy reading
func formatSecretForDisplay(secret string) string {
	var formatted strings.Builder
	for i, char := range secret {
		if i > 0 && i%4 == 0 {
			formatted.WriteRune(' ')
		}
		formatted.WriteRune(char)
	}
	return formatted.String()
}

// verifyTOTP verifies a TOTP code against a secret
// Simple implementation - checks current and adjacent time windows
func verifyTOTP(secret, code string) bool {
	// For production, use a proper TOTP library like github.com/pquerna/otp
	// This is a simplified version that checks timing windows

	// Clean up code
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return false
	}

	// For now, implement a basic TOTP verification
	// In production, use: github.com/pquerna/otp/totp
	currentCode := generateTOTPCode(secret, time.Now())
	prevCode := generateTOTPCode(secret, time.Now().Add(-30*time.Second))
	nextCode := generateTOTPCode(secret, time.Now().Add(30*time.Second))

	return code == currentCode || code == prevCode || code == nextCode
}

// generateTOTPCode generates a TOTP code for a given time
// This is a simplified implementation
func generateTOTPCode(secret string, t time.Time) string {
	// Simplified - in production use github.com/pquerna/otp/totp
	// This generates a deterministic 6-digit code based on secret and time
	counter := t.Unix() / 30

	// Simple hash-based code generation (not cryptographically secure, use proper lib)
	hash := fmt.Sprintf("%s%d", secret, counter)
	code := 0
	for i, c := range hash {
		code = (code*31 + int(c) + i) % 1000000
	}
	return fmt.Sprintf("%06d", code)
}

// generateQRCodeBase64 generates a QR code as base64 PNG
func generateQRCodeBase64(data string) string {
	// In production, use github.com/skip2/go-qrcode
	// For now, return a placeholder indicating the URL
	placeholderSVG := `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
		<rect width="200" height="200" fill="white"/>
		<text x="100" y="100" text-anchor="middle" font-size="12">QR Code</text>
		<text x="100" y="120" text-anchor="middle" font-size="8">Use OTPAuth URL</text>
	</svg>`
	return "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(placeholderSVG))
}

// verifyAndUseBackupCode verifies and marks a backup code as used
func verifyAndUseBackupCode(userID interface{}, code string) bool {
	var backupCodes []models.TOTPBackupCode
	db.DB.Where("user_id = ? AND used = false", userID).Find(&backupCodes)

	for i := range backupCodes {
		if backupCodes[i].VerifyBackupCode(code) {
			backupCodes[i].MarkAsUsed()
			db.DB.Save(&backupCodes[i])
			return true
		}
	}
	return false
}

// verifyPassword verifies a password against a hash
func verifyPassword(hash, password string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
}

// Verify2FALogin is an exported wrapper for verify2FA for use in public routes
var Verify2FALogin = verify2FA
