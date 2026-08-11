package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/sessionintent"
)

func remintSessionIntent(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	intentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid intent ID"})
		return
	}

	var record models.SessionIntentRecord
	if err := db.DB.Where("id = ? AND user_id = ? AND deleted_at IS NULL", intentID, userID).First(&record).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session intent not found"})
		return
	}

	if err := syncSessionIntentExpiration(&record); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refresh session intent state"})
		return
	}

	switch record.LifecycleState {
	case models.SessionIntentAuthorized, models.SessionIntentExpired:
		// remint allowed
	default:
		c.JSON(http.StatusConflict, gin.H{
			"error":           "Only authorized or expired intents can be reminted",
			"lifecycle_state": record.LifecycleState,
		})
		return
	}

	secret, err := sessionintent.ResolveSigningSecret()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Session intent signing is not configured"})
		return
	}

	listingID := ""
	if record.ListingID != nil {
		listingID = record.ListingID.String()
	}

	tokenString, claims, err := sessionintent.IssueWithID(secret, sessionintent.Params{
		UserID:                  userID,
		ListingID:               listingID,
		SessionType:             string(record.SessionType),
		TrustTier:               record.TrustTier,
		BandwidthLimit:          record.BandwidthLimit,
		TargetGeo:               record.TargetGeo,
		TargetISP:               record.TargetISP,
		RoutingProfile:          record.RoutingProfile,
		AllowedDomains:          []string(record.AllowedDomains),
		BlockedDomains:          []string(record.BlockedDomains),
		RotationType:            record.RotationType,
		RotationIntervalSeconds: record.RotationIntervalSeconds,
		TimeLimitMinutes:        record.TimeLimitMinutes,
		PreferredTier:           record.PreferredTier,
		RequestsPerMinute:       record.RequestsPerMinute,
		MaxConcurrency:          record.MaxConcurrency,
		MaxPricePerGB:           record.MaxPricePerGB,
	}, record.ID)
	if err != nil {
		logging.Error(err).Str("intent_id", record.ID.String()).Msg("Failed to remint session intent")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remint session intent"})
		return
	}

	now := time.Now().UTC()
	updates := map[string]interface{}{
		"expires_at":      claims.ExpiresAt.Time,
		"lifecycle_state": models.SessionIntentAuthorized,
		"expired_at":      nil,
		"updated_at":      now,
		"last_seen_at":    now,
	}
	if err := db.DB.Model(&record).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refresh session intent expiry"})
		return
	}
	record.ExpiresAt = claims.ExpiresAt.Time
	record.LifecycleState = models.SessionIntentAuthorized
	record.ExpiredAt = nil

	c.JSON(http.StatusOK, gin.H{
		"token":           tokenString,
		"expires_at":      claims.ExpiresAt.Time,
		"lifecycle_state": string(models.SessionIntentAuthorized),
		"intent":          buildSessionIntentStatusResponse(&record).Intent,
		"reminted":        true,
	})
}
