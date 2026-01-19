package middleware

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

type SupabaseUser struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

// SupabaseAuthMiddleware verifies the Bearer token by calling Supabase Auth API
func SupabaseAuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString := ""
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			tokenString = strings.Replace(authHeader, "Bearer ", "", 1)
		} else {
			// Fallback to query parameter (e.g. for WebSockets)
			tokenString = c.Query("token")
		}

		if tokenString == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header or token parameter required"})
			return
		}

		// 1. Try Local JWT Verification (Wallet Auth)
		if claims, err := crypto.ValidateToken(tokenString, cfg.Auth.JWTSecret); err == nil {
			// Valid local token
			c.Set("userID", claims.UserID)
			if uid, err := uuid.Parse(claims.UserID); err == nil {
				c.Set("user_id", uid)
			}
			c.Set("userEmail", claims.Email)
			c.Set("userRole", claims.Role)
			c.Next()
			return
		}

		// 2. Fallback to Supabase Auth API
		req, err := http.NewRequest("GET", fmt.Sprintf("%s/auth/v1/user", cfg.Auth.SupabaseURL), nil)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to create auth request"})
			return
		}

		req.Header.Set("Authorization", "Bearer "+tokenString)
		req.Header.Set("apikey", cfg.Auth.SupabaseAnonKey)

		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Failed to verify token"})
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			return
		}

		var user SupabaseUser
		if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse user data"})
			return
		}

		// Sync user to local DB if not exists
		// We do this synchronously to ensure downstream handlers find the user
		var dbUser models.User
		if result := db.DB.First(&dbUser, "id = ?", user.ID); result.Error != nil {
			// User not found, create new
			// We need to parse UUID from string
			userUUID, err := uuid.Parse(user.ID)
			if err != nil {
				logging.Error(err).Str("user_id", user.ID).Msg("Failed to parse UUID for sync")
				// Don't fail the request, but logging is vital
			} else {
				username := strings.Split(user.Email, "@")[0]
				if len(user.ID) >= 8 {
					username = fmt.Sprintf("%s_%s", username, user.ID[:8])
				}
				newUser := models.User{
					ID:        userUUID,
					Email:     user.Email,
					Username:  &username, // Provide pointer
					TrustTier: models.TrustTierNew,
					Role:      user.Role, // Based on models.User definition, Role is string, not models.UserRole
				}
				if createErr := db.DB.Create(&newUser).Error; createErr != nil {
					logging.Error(createErr).Str("user_id", user.ID).Msg("Failed to create user record")
				} else {
					logging.Info().Str("user_id", user.ID).Msg("User synced to local DB")
				}
			}
		}

		// Store in context
		c.Set("userID", user.ID)
		if uid, err := uuid.Parse(user.ID); err == nil {
			c.Set("user_id", uid)
		}
		c.Set("userEmail", user.Email)
		c.Set("userRole", user.Role)

		c.Next()
	}
}

// SupabaseAuthMiddlewareOptional validates token if present, but does not abort if missing.
func SupabaseAuthMiddlewareOptional(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString := ""
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			tokenString = strings.Replace(authHeader, "Bearer ", "", 1)
		} else {
			tokenString = c.Query("token")
		}

		if tokenString == "" {
			// No token, just proceed as guest
			c.Next()
			return
		}

		// 1. Try Local JWT Verification
		if claims, err := crypto.ValidateToken(tokenString, cfg.Auth.JWTSecret); err == nil {
			c.Set("userID", claims.UserID)
			if uid, err := uuid.Parse(claims.UserID); err == nil {
				c.Set("user_id", uid)
			}
			c.Set("userEmail", claims.Email)
			c.Set("userRole", claims.Role)
			c.Next()
			return
		}

		// 2. Fallback to Supabase Auth API
		req, err := http.NewRequest("GET", fmt.Sprintf("%s/auth/v1/user", cfg.Auth.SupabaseURL), nil)
		if err != nil {
			// Error creating request, ignore and proceed as guest (or log warning)
			logging.Warn().Err(err).Msg("Auth optional: failed to create request")
			c.Next()
			return
		}

		req.Header.Set("Authorization", "Bearer "+tokenString)
		req.Header.Set("apikey", cfg.Auth.SupabaseAnonKey)

		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			// Request failed, ignore
			c.Next()
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			// Invalid token, treat as guest
			c.Next()
			return
		}

		var user SupabaseUser
		if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
			c.Next()
			return
		}

		// Sync user to local DB
		var dbUser models.User
		if result := db.DB.First(&dbUser, "id = ?", user.ID); result.Error != nil {
			userUUID, _ := uuid.Parse(user.ID)
			username := strings.Split(user.Email, "@")[0]
			if len(user.ID) >= 8 {
				username = fmt.Sprintf("%s_%s", username, user.ID[:8])
			}
			newUser := models.User{
				ID:        userUUID,
				Email:     user.Email,
				Username:  &username,
				TrustTier: models.TrustTierNew,
				Role:      user.Role,
			}
			db.DB.Create(&newUser)
		}

		// Store in context
		c.Set("userID", user.ID)
		if uid, err := uuid.Parse(user.ID); err == nil {
			c.Set("user_id", uid)
		}
		c.Set("userEmail", user.Email)
		c.Set("userRole", user.Role)

		c.Next()
	}
}

// RequireAuth aborts if user is not authenticated
func RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, exists := c.Get("user_id"); !exists {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
			return
		}
		c.Next()
	}
}
