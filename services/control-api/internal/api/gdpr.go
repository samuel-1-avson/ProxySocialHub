package api

import (
	"errors"
	"github.com/proxyhubb/control-api/internal/accountclosure"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterGDPRRoutes registers GDPR/data export routes
func RegisterGDPRRoutes(rg *gin.RouterGroup) {
	rg.GET("/gdpr/export", StrictRateLimit(), requestDataExport)
	rg.GET("/gdpr/deletion", deletionStatus)
	rg.POST("/gdpr/deletion/cancel", StrictRateLimit(), cancelDeletion)
	rg.DELETE("/gdpr/delete-account", StrictRateLimit(), deleteAccount)
}

// deleteAccount schedules account for deletion
func deleteAccount(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16384)
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req struct {
		Confirmation     string `json:"confirmation" binding:"required"`
		Nonce            string `json:"nonce"`
		GoogleCredential string `json:"google_credential"`
		Code             string `json:"code"`
		Signature        string `json:"signature"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Confirmation != "DELETE MY ACCOUNT" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Please type 'DELETE MY ACCOUNT' to confirm"})
		return
	}

	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Managed accounts reauthenticate with their linked identity, external wallets sign.
	var managed int64
	if err := db.DB.Model(&models.EmbeddedWallet{}).Where("user_id = ?", userID).Count(&managed).Error; err != nil {
		c.JSON(503, gin.H{"error": "Cannot verify account ownership"})
		return
	}
	if managed > 0 {
		identity, err := verifyGoogleToken(c.Request.Context(), req.GoogleCredential, cashoutGoogleClientID())
		if err != nil || identity.IssuedAt < time.Now().Add(-5*time.Minute).Unix() || identity.IssuedAt > time.Now().Add(time.Minute).Unix() {
			c.JSON(403, gin.H{"error": "Confirm with your linked Google account"})
			return
		}
		var n int64
		if db.DB.Model(&models.UserIdentity{}).Where("user_id = ? AND provider = ? AND subject = ?", userID, models.IdentityProviderGoogle, identity.Subject).Count(&n).Error != nil || n != 1 {
			c.JSON(403, gin.H{"error": "Account confirmation failed"})
			return
		}
	} else if user.WalletAddress != nil && *user.WalletAddress != "" {
		if !verifyWalletSignedMessage(c, *user.WalletAddress, req.Nonce, req.Signature, "delete-account:"+req.Nonce, "gdpr:delete-account") {
			c.JSON(403, gin.H{"error": "Linked wallet signature required"})
			return
		}
	} else {
		c.JSON(409, gin.H{"error": "A linked sign-in identity is required"})
		return
	}
	// Schedule deletion (30 days grace period)
	deletionDate := time.Now().AddDate(0, 0, 30)
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		var locked models.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&locked, "id = ?", userID).Error; err != nil {
			return err
		}
		var settings models.UserSettings
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&settings).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if settings.TwoFactorEnabled {
			if !verifyFactor(&settings, req.Code) {
				return errors.New("MFA confirmation required")
			}
			if err := tx.Save(&settings).Error; err != nil {
				return err
			}
		}
		if err := accountclosure.Check(c.Request.Context(), tx, userID, false); err != nil {
			return err
		}
		return tx.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]interface{}{"scheduled_deletion_at": deletionDate, "profile_public": false, "discoverable": false, "map_visible": false, "presence_visible": false, "activity_public": false, "analytics_opt_in": false, "allow_direct_connections": false, "public_chain_consent": false, "contact_mode": "nobody"}).Error
	})
	if err != nil {
		message := "Account confirmation or closure checks failed. Verify your factor, settle active services and funds, then try again."
		if errors.Is(err, accountclosure.ErrUnsettled) {
			message = err.Error()
		}
		c.JSON(409, gin.H{"error": message})
		return
	}
	invalidateMarketplaceReadModels()
	invalidateExplorerCache("explorer:*")

	auditEntry := models.AuditLog{
		EventType:   models.AuditUserDeleted,
		Severity:    models.AuditSeverityCritical,
		ActorID:     &userID,
		ActorEmail:  user.Email,
		TargetType:  "user",
		TargetID:    userID.String(),
		Description: "Account scheduled for deletion",
		Success:     true,
	}
	db.DB.Create(&auditEntry)

	c.JSON(http.StatusOK, gin.H{
		"message":       "Account scheduled for deletion",
		"deletion_date": deletionDate,
		"note":          "You can cancel this by logging in before the deletion date",
	})
}

func deletionStatus(c *gin.Context) {
	u, ok := privacyUser(c)
	if !ok {
		return
	}
	restriction := ""
	if err := accountclosure.Check(c.Request.Context(), db.DB, u.ID, false); err != nil {
		restriction = "Account safety checks are unavailable. Deletion will wait."
		if errors.Is(err, accountclosure.ErrUnsettled) {
			restriction = err.Error()
		}
	}
	c.JSON(200, gin.H{"scheduled_deletion_at": u.ScheduledDeletionAt, "restriction_reason": restriction, "grace_period_days": 30, "note": "Public blockchain records and required payment records remain. Managed keys are purged only after empty-wallet verification; never send funds to an address after closure."})
}
func cancelDeletion(c *gin.Context) {
	u, ok := privacyUser(c)
	if !ok {
		return
	}
	if err := db.DB.Model(&models.User{}).Where("id = ?", u.ID).Update("scheduled_deletion_at", nil).Error; err != nil {
		c.JSON(503, gin.H{"error": "Cannot cancel deletion"})
		return
	}
	c.JSON(200, gin.H{"scheduled_deletion_at": nil, "note": "Privacy settings remain as chosen; enable visibility explicitly."})
}
