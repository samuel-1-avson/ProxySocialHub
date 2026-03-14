package api

import (
	"crypto/subtle"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/crypto"
)

var adminCfg *config.AdminConfig

// InitAdminConfig stores the admin config for use by login handlers.
func InitAdminConfig(cfg *config.AdminConfig) {
	adminCfg = cfg
}

// RegisterAdminAuthRoutes registers the public admin auth endpoints (no auth required).
func RegisterAdminAuthRoutes(r *gin.RouterGroup) {
	r.POST("/login", adminLogin)
	r.POST("/logout", adminLogout)
}

// RegisterAdminMeRoute registers the authenticated /me endpoint.
func RegisterAdminMeRoute(r *gin.RouterGroup) {
	r.GET("/me", adminMe)
}

// ========== Handlers ==========

type adminLoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type adminLoginResponse struct {
	Token string      `json:"token"`
	Admin adminIdentity `json:"admin"`
}

type adminIdentity struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}

// adminLogin validates credentials and returns a signed admin JWT.
func adminLogin(c *gin.Context) {
	if adminCfg == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Admin config not initialized"})
		return
	}

	var req adminLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username and password are required"})
		return
	}

	// Find matching account using constant-time comparison to prevent timing attacks
	var matched *config.AdminAccount
	for i := range adminCfg.Accounts {
		acc := &adminCfg.Accounts[i]
		usernameMatch := subtle.ConstantTimeCompare([]byte(req.Username), []byte(acc.Username)) == 1
		passwordMatch := subtle.ConstantTimeCompare([]byte(req.Password), []byte(acc.Password)) == 1
		if usernameMatch && passwordMatch {
			matched = acc
			break
		}
	}

	if matched == nil {
		// Uniform delay to prevent username enumeration
		time.Sleep(300 * time.Millisecond)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	// Generate a deterministic stable UUID for this admin account
	// (not a DB user — admin accounts live in config only)
	adminID := uuid.NewSHA1(uuid.NameSpaceURL, []byte("admin:"+matched.Username))

	ttl := time.Duration(adminCfg.SessionTTLHr) * time.Hour
	token, err := crypto.GenerateToken(adminID, matched.Role, matched.Username, "", adminCfg.JWTSecret, ttl)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, adminLoginResponse{
		Token: token,
		Admin: adminIdentity{
			Username: matched.Username,
			Role:     matched.Role,
		},
	})
}

// adminLogout is a no-op on the server (stateless JWT). Client must discard the token.
func adminLogout(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}

// adminMe returns the identity of the currently authenticated admin.
func adminMe(c *gin.Context) {
	username := c.GetString("adminUsername")
	role := c.GetString("adminRole")

	c.JSON(http.StatusOK, gin.H{
		"username": username,
		"role":     role,
	})
}
