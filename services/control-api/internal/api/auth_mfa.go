package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"strings"
	"time"
)

func completeLoginOrChallenge(c *gin.Context, user models.User, secret string) {
	if !user.IsActive() {
		c.JSON(http.StatusForbidden, gin.H{"error": "Account is unavailable"})
		return
	}
	var settings models.UserSettings
	if err := db.DB.Where("user_id = ?", user.ID).First(&settings).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Security settings unavailable"})
		return
	}
	if settings.TwoFactorEnabled {
		challenge := models.AuthMFAChallenge{ID: uuid.New(), UserID: user.ID, ExpiresAt: time.Now().Add(5 * time.Minute)}
		if err := db.DB.Create(&challenge).Error; err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Cannot start verification"})
			return
		}
		token, err := crypto.GenerateMFAChallenge(user.ID, challenge.ID, secret)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Cannot start verification"})
			return
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, gin.H{"mfa_required": true, "challenge_token": token, "expires_in": 300})
		return
	}
	finishAccountLogin(c, user, secret)
}

func finishAccountLogin(c *gin.Context, user models.User, secret string) {
	session, err := issueRequestAuthSession(c, user, secret)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Cannot establish session"})
		return
	}
	if user.ScheduledDeletionAt != nil {
		_ = db.DB.Model(&models.User{}).Where("id = ?", user.ID).Update("scheduled_deletion_at", nil).Error
	}
	applyAuthSessionCookies(c, session)
	RecordAuditLog(c, models.AuditAuthLogin, models.AuditSeverityInfo, &user.ID, "user", user.ID.String(), "Account sign-in completed", true)
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, session)
}

// verifyFactor consumes a backup code or remembers an accepted TOTP to prevent
// replay during the clock-skew window. Caller holds a row lock and saves settings.
func verifyFactor(settings *models.UserSettings, code string) bool {
	code = strings.TrimSpace(code)
	if mfaService.VerifyTOTP(settings.TwoFactorSecret, code) {
		mac := hmac.New(sha256.New, []byte(settings.TwoFactorSecret))
		mac.Write([]byte(code))
		sum := hex.EncodeToString(mac.Sum(nil))
		if settings.LastTOTPHash == sum && settings.LastTOTPAt != nil && time.Since(*settings.LastTOTPAt) < 90*time.Second {
			return false
		}
		now := time.Now()
		settings.LastTOTPHash = sum
		settings.LastTOTPAt = &now
		return true
	}
	var hashes []string
	if json.Unmarshal([]byte(settings.TwoFactorBackupCodes), &hashes) != nil {
		return false
	}
	ok, index := mfaService.VerifyBackupCode(code, hashes)
	if !ok {
		return false
	}
	hashes = append(hashes[:index], hashes[index+1:]...)
	data, _ := json.Marshal(hashes)
	settings.TwoFactorBackupCodes = string(data)
	return true
}

func verifyMFALogin(c *gin.Context) {
	var req struct {
		ChallengeToken string `json:"challenge_token" binding:"required,max=4096"`
		Code           string `json:"code" binding:"required,min=6,max=32"`
	}
	if c.ShouldBindJSON(&req) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Verification code required"})
		return
	}
	secret, err := requireJWTSecret()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Authentication unavailable"})
		return
	}
	claims, err := crypto.ValidateToken(req.ChallengeToken, secret)
	if err != nil || claims.Kind != crypto.TokenKindMFA {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Verification expired"})
		return
	}
	challengeID, err := uuid.Parse(claims.ID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Verification expired"})
		return
	}
	accepted := false
	err = db.DB.Transaction(func(tx *gorm.DB) error {
		var ch models.AuthMFAChallenge
		if e := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", challengeID, claims.UserID).First(&ch).Error; e != nil {
			return e
		}
		if ch.ConsumedAt != nil || ch.Attempts >= 5 || time.Now().After(ch.ExpiresAt) {
			return nil
		}
		ch.Attempts++
		var settings models.UserSettings
		if e := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", ch.UserID).First(&settings).Error; e != nil {
			return e
		}
		if settings.TwoFactorEnabled && verifyFactor(&settings, req.Code) {
			now := time.Now()
			ch.ConsumedAt = &now
			if e := tx.Save(&settings).Error; e != nil {
				return e
			}
			accepted = true
		}
		return tx.Save(&ch).Error
	})
	if err != nil || !accepted {
		if uid, e := uuid.Parse(claims.UserID); e == nil {
			RecordAuditLog(c, models.AuditAuthLoginFailed, models.AuditSeverityWarning, &uid, "user", uid.String(), "MFA sign-in verification failed", false)
		}
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Verification failed or expired"})
		return
	}
	var user models.User
	if err = db.DB.First(&user, "id = ?", claims.UserID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Account unavailable"})
		return
	}
	finishAccountLogin(c, user, secret)
}

func recordFailedWalletLogin(c *gin.Context, address string) {
	var account struct{ ID uuid.UUID }
	var actor *uuid.UUID
	if db.DB.Table("profiles").Select("id").Where("wallet_address = ?", address).Take(&account).Error == nil {
		actor = &account.ID
	}
	target := ""
	if actor != nil {
		target = actor.String()
	}
	RecordAuditLog(c, models.AuditAuthLoginFailed, models.AuditSeverityWarning, actor, "user", target, "Wallet sign-in signature verification failed", false)
}
