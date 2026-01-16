package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/email"
	"github.com/proxyhubb/control-api/internal/models"
	"golang.org/x/crypto/bcrypt"
)

func RegisterAuthRoutes(r *gin.RouterGroup) {
	auth := r.Group("/auth")
	{
		auth.POST("/register", register)
		auth.POST("/login", login)
		auth.POST("/refresh", refreshToken)
		auth.POST("/verify-email", verifyEmail)
		auth.POST("/verify-email", verifyEmail)
		auth.POST("/resend-verification", resendVerification)
	}

	// Register OAuth routes
	RegisterOAuthRoutes(r)
}

type registerRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8"`
	Role     string `json:"role" binding:"required,oneof=buyer provider"`
}

type loginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

func register(c *gin.Context) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if database is available
	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	// Check if email already exists
	var existingUser models.User
	if result := db.DB.Where("email = ?", req.Email).First(&existingUser); result.Error == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Email already registered"})
		return
	}

	// Hash password using bcrypt with cost factor 12
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process password"})
		return
	}

	user := models.User{
		Email:         req.Email,
		PasswordHash:  string(hashedPassword),
		Role:          req.Role,
		EmailVerified: false,
	}

	// Generate verification token
	token := user.GenerateVerificationToken()

	if result := db.DB.Create(&user); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}

	// Send verification email
	if emailService := email.GetService(); emailService != nil {
		if err := emailService.SendVerificationEmail(user.Email, token); err != nil {
			// Log error but don't fail registration
			// User can request resend
		}
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":                    user.ID,
		"email":                 user.Email,
		"role":                  user.Role,
		"email_verified":        false,
		"message":               "Registration successful. Please check your email to verify your account.",
		"verification_required": true,
	})
}

func login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if database is available
	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	// Find user by email
	var user models.User
	if result := db.DB.Where("email = ?", req.Email).First(&user); result.Error != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	// Verify password using bcrypt
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	// Check if email is verified (optional - configurable via env)
	requireVerification := true // Can be made configurable
	if requireVerification && !user.EmailVerified {
		c.JSON(http.StatusForbidden, gin.H{
			"error":                 "Please verify your email before logging in",
			"code":                  "email_not_verified",
			"email":                 user.Email,
			"verification_required": true,
		})
		return
	}

	// Check if 2FA is enabled
	if user.TOTPEnabled {
		// Generate temp token for 2FA verification
		tempToken, err := GenerateTempToken(user.ID.String())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"requires_2fa": true,
			"temp_token":   tempToken,
			"message":      "Please enter your 2FA code",
		})
		return
	}

	// Generate token pair (no 2FA)
	tokenPair, err := GenerateTokenPair(user.ID.String(), user.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
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
	})
}

func refreshToken(c *gin.Context) {
	var req refreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate refresh token
	claims, err := ValidateRefreshToken(req.RefreshToken)
	if err != nil {
		if err == ErrExpiredToken {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Refresh token has expired. Please login again.",
				"code":  "refresh_expired",
			})
			return
		}
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid refresh token"})
		return
	}

	// Get user to include role in new token
	var user models.User
	if db.DB != nil {
		if result := db.DB.First(&user, "id = ?", claims.UserID); result.Error != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
			return
		}
	}

	// Generate new token pair
	tokenPair, err := GenerateTokenPair(claims.UserID, user.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access_token":  tokenPair.AccessToken,
		"refresh_token": tokenPair.RefreshToken,
		"expires_in":    tokenPair.ExpiresIn,
		"token_type":    tokenPair.TokenType,
	})
}

// verifyEmailRequest is the request struct for email verification
type verifyEmailRequest struct {
	Token string `json:"token" binding:"required"`
}

// resendVerificationRequest is the request struct for resending verification
type resendVerificationRequest struct {
	Email string `json:"email" binding:"required,email"`
}

// verifyEmail handles email verification
func verifyEmail(c *gin.Context) {
	var req verifyEmailRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	// Find user by verification token
	var user models.User
	if result := db.DB.Where("verification_token = ?", req.Token).First(&user); result.Error != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid or expired verification token",
			"code":  "invalid_token",
		})
		return
	}

	// Check if token is valid and not expired
	if !user.IsVerificationTokenValid(req.Token) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Verification token has expired. Please request a new one.",
			"code":  "token_expired",
		})
		return
	}

	// Mark email as verified
	user.ClearVerificationToken()
	user.Status = models.UserStatusActive

	if result := db.DB.Save(&user); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify email"})
		return
	}

	// Generate token pair so user can login immediately
	tokenPair, err := GenerateTokenPair(user.ID.String(), user.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "Email verified successfully",
		"access_token":  tokenPair.AccessToken,
		"refresh_token": tokenPair.RefreshToken,
		"expires_in":    tokenPair.ExpiresIn,
		"token_type":    tokenPair.TokenType,
		"user": gin.H{
			"id":             user.ID,
			"email":          user.Email,
			"role":           user.Role,
			"email_verified": true,
		},
	})
}

// resendVerification resends the verification email
func resendVerification(c *gin.Context) {
	var req resendVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	// Find user by email
	var user models.User
	if result := db.DB.Where("email = ?", req.Email).First(&user); result.Error != nil {
		// Don't reveal if email exists
		c.JSON(http.StatusOK, gin.H{
			"message": "If an account with this email exists, a verification email has been sent.",
		})
		return
	}

	// Check if already verified
	if user.EmailVerified {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Email is already verified",
			"code":  "already_verified",
		})
		return
	}

	// Generate new verification token
	token := user.GenerateVerificationToken()

	if result := db.DB.Save(&user); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate verification token"})
		return
	}

	// Send verification email
	if emailService := email.GetService(); emailService != nil {
		if err := emailService.SendVerificationEmail(user.Email, token); err != nil {
			// Log error but still return success to prevent email enumeration
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "If an account with this email exists, a verification email has been sent.",
	})
}
