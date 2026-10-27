package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

const (
	accessTokenStorageKey  = "proxyhubb_token"
	refreshTokenStorageKey = "proxyhubb_refresh_token"
)

type authSessionResponse struct {
	Token                 string      `json:"token"`
	RefreshToken          string      `json:"refresh_token,omitempty"`
	AccessTokenExpiresAt  time.Time   `json:"access_token_expires_at"`
	RefreshTokenExpiresAt *time.Time  `json:"refresh_token_expires_at,omitempty"`
	User                  interface{} `json:"user,omitempty"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func authAccessTokenTTL() time.Duration {
	const defaultMinutes = 24 * 60

	if raw := strings.TrimSpace(os.Getenv("ACCESS_TOKEN_TTL_MINUTES")); raw != "" {
		if minutes, err := strconv.Atoi(raw); err == nil && minutes > 0 {
			return time.Duration(minutes) * time.Minute
		}
	}

	return defaultMinutes * time.Minute
}

func authRefreshTokenTTL() time.Duration {
	const defaultHours = 30 * 24

	if raw := strings.TrimSpace(os.Getenv("REFRESH_TOKEN_TTL_HOURS")); raw != "" {
		if hours, err := strconv.Atoi(raw); err == nil && hours > 0 {
			return time.Duration(hours) * time.Hour
		}
	}

	return defaultHours * time.Hour
}

func issueAuthSession(user models.User, walletAddress string, jwtSecret string) (authSessionResponse, error) {
	accessTTL := authAccessTokenTTL()
	accessToken, err := crypto.GenerateToken(
		user.ID,
		user.Role,
		user.Email,
		walletAddress,
		jwtSecret,
		accessTTL,
	)
	if err != nil {
		return authSessionResponse{}, err
	}

	response := authSessionResponse{
		Token:                accessToken,
		AccessTokenExpiresAt: time.Now().Add(accessTTL),
	}

	if !refreshTokenStorageReady() {
		return response, nil
	}

	refreshTTL := authRefreshTokenTTL()
	rawRefreshToken, record, err := newRefreshTokenRecord(user.ID, "", "", refreshTTL)
	if err != nil {
		log.Printf("[AUTH] Failed to create refresh token material for user %s: %v", user.ID, err)
		return response, nil
	}

	if err := db.DB.Create(&record).Error; err != nil {
		log.Printf("[AUTH] Failed to persist refresh token for user %s: %v", user.ID, err)
		return response, nil
	}

	response.RefreshToken = rawRefreshToken
	response.RefreshTokenExpiresAt = &record.ExpiresAt

	return response, nil
}

func refreshSession(c *gin.Context) {
	if !refreshTokenStorageReady() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "refresh token storage unavailable"})
		return
	}

	var req refreshRequest
	_ = c.ShouldBindJSON(&req)

	candidates := refreshTokenCandidates(req.RefreshToken, c.Request.Cookies())
	if len(candidates) == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token required"})
		return
	}

	// Use the first candidate the database knows. Only tokens it issued are accepted, so
	// trying more than one does not widen what a caller can do.
	var current models.RefreshTokenFamily
	found := false
	for _, raw := range candidates {
		err := db.DB.Where("token_hash = ?", hashRefreshToken(raw)).First(&current).Error
		if err == nil {
			found = true
			break
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("[AUTH] Refresh token lookup failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to refresh session"})
			return
		}
	}
	if !found {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}

	now := time.Now()
	if current.RevokedAt != nil || now.After(current.ExpiresAt) {
		revokeRefreshTokenFamily(current.FamilyID)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token expired"})
		return
	}

	if !current.IsCurrent {
		revokeRefreshTokenFamily(current.FamilyID)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token reuse detected"})
		return
	}

	var user models.User
	if err := db.DB.Where("id = ?", current.UserID).First(&user).Error; err != nil {
		log.Printf("[AUTH] Refresh token user lookup failed: %v", err)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}

	walletAddress := ""
	if user.WalletAddress != nil {
		walletAddress = *user.WalletAddress
	}

	jwtSecret, err := requireJWTSecret()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "authentication is not configured"})
		return
	}

	accessTTL := authAccessTokenTTL()
	accessToken, err := crypto.GenerateToken(
		user.ID,
		user.Role,
		user.Email,
		walletAddress,
		jwtSecret,
		accessTTL,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate access token"})
		return
	}

	refreshTTL := authRefreshTokenTTL()
	newRawRefreshToken, nextRecord, err := newRefreshTokenRecord(user.ID, current.FamilyID, current.TokenID, refreshTTL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to rotate refresh token"})
		return
	}

	tx := db.DB.Begin()
	if err := tx.Model(&models.RefreshTokenFamily{}).
		Where("id = ?", current.ID).
		Updates(map[string]interface{}{"is_current": false}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to rotate refresh token"})
		return
	}

	if err := tx.Create(&nextRecord).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist refresh token"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit refresh token rotation"})
		return
	}

	writeAuthCookies(c, accessToken, newRawRefreshToken, accessTTL, time.Until(nextRecord.ExpiresAt))
	c.JSON(http.StatusOK, authSessionResponse{
		Token:                 accessToken,
		RefreshToken:          newRawRefreshToken,
		AccessTokenExpiresAt:  now.Add(accessTTL),
		RefreshTokenExpiresAt: &nextRecord.ExpiresAt,
		User:                  user,
	})
}

// refreshTokenCandidates lists the refresh tokens a request carries, best first: the JSON
// body token, then every refresh cookie, without duplicates or blanks.
//
// Taking the body token alone (or only the first cookie) signed users out right after they
// signed in. The web app sends a refresh token from localStorage in the body once, to migrate
// old sessions; when it was stale it won over the valid HttpOnly cookie in the same request and
// the client then discarded the session. And a legacy cookie with the same name can sit next to
// the current one: browsers send the older cookie first and Request.Cookie returns the first
// match, so the current token was never read and every refresh failed.
func refreshTokenCandidates(bodyToken string, cookies []*http.Cookie) []string {
	var out []string
	seen := map[string]bool{}
	add := func(raw string) {
		raw = strings.TrimSpace(raw)
		if raw != "" && !seen[raw] {
			seen[raw] = true
			out = append(out, raw)
		}
	}
	add(bodyToken)
	for _, ck := range cookies {
		if ck.Name == refreshTokenStorageKey {
			add(ck.Value)
		}
	}
	return out
}

func refreshTokenStorageReady() bool {
	return db.DB != nil && db.DB.Migrator().HasTable(&models.RefreshTokenFamily{})
}

func writeAuthCookies(c *gin.Context, accessToken, refreshToken string, accessTTL, refreshTTL time.Duration) {
	secure := cookieSecure(c)
	if accessToken != "" && accessTTL > 0 {
		c.SetSameSite(http.SameSiteLaxMode)
		c.SetCookie(accessTokenStorageKey, accessToken, int(accessTTL.Seconds()), "/", "", secure, true)
	}
	if refreshToken != "" && refreshTTL > 0 {
		c.SetSameSite(http.SameSiteLaxMode)
		c.SetCookie(refreshTokenStorageKey, refreshToken, int(refreshTTL.Seconds()), "/", "", secure, true)
	}
	// Non-HttpOnly marker so the SPA knows a refresh session exists without reading the secret.
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("proxyhubb_session", "1", int(refreshTTL.Seconds()), "/", "", secure, false)
}

func clearAuthCookies(c *gin.Context) {
	secure := cookieSecure(c)
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(accessTokenStorageKey, "", -1, "/", "", secure, true)
	c.SetCookie(refreshTokenStorageKey, "", -1, "/", "", secure, true)
	c.SetCookie("proxyhubb_session", "", -1, "/", "", secure, false)
}

func cookieSecure(c *gin.Context) bool {
	if c.Request.TLS != nil {
		return true
	}
	if proto := strings.ToLower(strings.TrimSpace(c.GetHeader("X-Forwarded-Proto"))); proto == "https" {
		return true
	}
	env := strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT")))
	return env == "production" || env == "prod" || env == "testnet"
}

func applyAuthSessionCookies(c *gin.Context, session authSessionResponse) {
	accessTTL := time.Until(session.AccessTokenExpiresAt)
	if accessTTL <= 0 {
		accessTTL = authAccessTokenTTL()
	}
	refreshTTL := authRefreshTokenTTL()
	if session.RefreshTokenExpiresAt != nil {
		refreshTTL = time.Until(*session.RefreshTokenExpiresAt)
	}
	writeAuthCookies(c, session.Token, session.RefreshToken, accessTTL, refreshTTL)
}

func logoutSession(c *gin.Context) {
	// Revoke every session this browser presents, not only the first cookie of that name.
	for _, raw := range refreshTokenCandidates("", c.Request.Cookies()) {
		var current models.RefreshTokenFamily
		if err := db.DB.Where("token_hash = ?", hashRefreshToken(raw)).First(&current).Error; err == nil {
			revokeRefreshTokenFamily(current.FamilyID)
		}
	}
	clearAuthCookies(c)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func revokeRefreshTokenFamily(familyID string) {
	if familyID == "" || db.DB == nil {
		return
	}

	now := time.Now()
	if err := db.DB.Model(&models.RefreshTokenFamily{}).
		Where("family_id = ? AND revoked_at IS NULL", familyID).
		Updates(map[string]interface{}{
			"revoked_at": now,
			"is_current": false,
		}).Error; err != nil {
		log.Printf("[AUTH] Failed to revoke refresh token family %s: %v", familyID, err)
	}
}

func revokeAllRefreshTokenFamilies(userID uuid.UUID) {
	if userID == uuid.Nil || db.DB == nil {
		return
	}
	now := time.Now()
	if err := db.DB.Model(&models.RefreshTokenFamily{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Updates(map[string]interface{}{
			"revoked_at": now,
			"is_current": false,
		}).Error; err != nil {
		log.Printf("[AUTH] Failed to revoke all refresh token families for user %s: %v", userID, err)
	}
}

func newRefreshTokenRecord(userID uuid.UUID, familyID string, parentTokenID string, ttl time.Duration) (string, models.RefreshTokenFamily, error) {
	randomPart, err := randomHex(32)
	if err != nil {
		return "", models.RefreshTokenFamily{}, err
	}

	if familyID == "" {
		familyID, err = randomHex(16)
		if err != nil {
			return "", models.RefreshTokenFamily{}, err
		}
	}

	tokenID, err := randomHex(16)
	if err != nil {
		return "", models.RefreshTokenFamily{}, err
	}

	issuedAt := time.Now()
	rawToken := strings.Join([]string{familyID, tokenID, randomPart}, ".")

	return rawToken, models.RefreshTokenFamily{
		FamilyID:      familyID,
		UserID:        userID,
		TokenID:       tokenID,
		TokenHash:     hashRefreshToken(rawToken),
		ParentTokenID: parentTokenID,
		IssuedAt:      issuedAt,
		ExpiresAt:     issuedAt.Add(ttl),
		IsCurrent:     true,
	}, nil
}

func hashRefreshToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func randomHex(numBytes int) (string, error) {
	b := make([]byte, numBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func requireJWTSecret() (string, error) {
	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if secret == "" {
		return "", errors.New("JWT_SECRET is not configured")
	}
	return secret, nil
}
