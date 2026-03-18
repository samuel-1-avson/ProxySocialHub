package middleware

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm/clause"
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

		// 2. Try Provider Token (CLI authentication)
		if providerToken, _ := validateProviderToken(tokenString); providerToken != nil {
			// Valid provider token - set user context
			c.Set("userID", providerToken.UserID.String())
			c.Set("user_id", providerToken.UserID)
			c.Set("token_id", providerToken.ID)
			c.Set("userEmail", "") // Provider tokens don't have email
			c.Set("userRole", "provider")
			c.Set("auth_type", "provider_token")
			
			// Update last used asynchronously
			go func() {
				db.DB.Model(&models.ProviderToken{}).
					Where("id = ?", providerToken.ID).
					Update("last_used", time.Now())
			}()
			
			c.Next()
			return
		}

		// 3. Fallback to Supabase Auth API with circuit breaker protection
		var user SupabaseUser
		err := ProtectedServiceCall(c, "supabase", func() error {
			req, err := http.NewRequest("GET", fmt.Sprintf("%s/auth/v1/user", cfg.Auth.SupabaseURL), nil)
			if err != nil {
				return err
			}

			req.Header.Set("Authorization", "Bearer "+tokenString)
			req.Header.Set("apikey", cfg.Auth.SupabaseAnonKey)

			client := &http.Client{}
			resp, err := client.Do(req)
			if err != nil {
				return err
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				return fmt.Errorf("invalid token: status %d", resp.StatusCode)
			}

			return json.NewDecoder(resp.Body).Decode(&user)
		})

		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Failed to verify token"})
			return
		}

		// Sync user to local DB if not exists
		var dbUser models.User
		userUUID, err := uuid.Parse(user.ID)
		if err != nil {
			logging.Error(err).Str("user_id", user.ID).Msg("Failed to parse UUID for sync")
		} else {
			if result := db.DB.First(&dbUser, "id = ?", userUUID); result.Error != nil {
				// User not found, create new
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
				if createErr := db.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&newUser).Error; createErr != nil {
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

		// 2. Fallback to Supabase Auth API with circuit breaker protection
		var user SupabaseUser
		err := ProtectedServiceCall(c, "supabase", func() error {
			req, err := http.NewRequest("GET", fmt.Sprintf("%s/auth/v1/user", cfg.Auth.SupabaseURL), nil)
			if err != nil {
				return err
			}

			req.Header.Set("Authorization", "Bearer "+tokenString)
			req.Header.Set("apikey", cfg.Auth.SupabaseAnonKey)

			client := &http.Client{}
			resp, err := client.Do(req)
			if err != nil {
				return err
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				return fmt.Errorf("invalid token: status %d", resp.StatusCode)
			}

			return json.NewDecoder(resp.Body).Decode(&user)
		})

		if err != nil {
			// Request failed, ignore and proceed as guest
			c.Next()
			return
		}

		// Sync user to local DB
		var dbUser models.User
		userUUID, err := uuid.Parse(user.ID)
		if err == nil {
			if result := db.DB.First(&dbUser, "id = ?", userUUID); result.Error != nil {
				// User not found, create new (Atomically)
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
				// Use OnConflict to handle race conditions during parallel requests
				if createErr := db.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&newUser).Error; createErr != nil {
					logging.Error(createErr).Str("user_id", user.ID).Msg("Failed to sync guest user record")
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


