package api

import (
	"math"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/sessionintent"
)

const bytesPerGB = 1024 * 1024 * 1024

type sessionIntentUsageSnapshot struct {
	TotalBytes         int64   `json:"total_bytes"`
	TotalBytesUp       int64   `json:"total_bytes_up"`
	TotalBytesDown     int64   `json:"total_bytes_down"`
	LastBytesUpDelta   int64   `json:"last_bytes_up_delta"`
	LastBytesDownDelta int64   `json:"last_bytes_down_delta"`
	TotalGB            float64 `json:"total_gb"`
	PercentUsed        float64 `json:"percent_used"`
	BytesRemaining     int64   `json:"bytes_remaining"`
	Unlimited          bool    `json:"unlimited"`
}

type sessionIntentBillingSnapshot struct {
	Currency              string  `json:"currency"`
	PriceSource           string  `json:"price_source"`
	UnitPriceUSDPerGB     float64 `json:"unit_price_usd_per_gb"`
	UnitPriceSOLPerGB     float64 `json:"unit_price_sol_per_gb"`
	EstimatedCostUSD      float64 `json:"estimated_cost_usd"`
	EstimatedCostSOL      float64 `json:"estimated_cost_sol"`
	ProjectedLimitCostUSD float64 `json:"projected_full_limit_cost_usd"`
	ProjectedLimitCostSOL float64 `json:"projected_full_limit_cost_sol"`
}

type sessionIntentStatusResponse struct {
	LifecycleState    string                       `json:"lifecycle_state"`
	ExpiresAt         time.Time                    `json:"expires_at"`
	CreatedAt         time.Time                    `json:"created_at"`
	UpdatedAt         time.Time                    `json:"updated_at"`
	RoutedAt          *time.Time                   `json:"routed_at,omitempty"`
	ActivatedAt       *time.Time                   `json:"activated_at,omitempty"`
	ClosingAt         *time.Time                   `json:"closing_at,omitempty"`
	LedgerCommittedAt *time.Time                   `json:"ledger_committed_at,omitempty"`
	BatchedAt         *time.Time                   `json:"batched_at,omitempty"`
	ChainCommittedAt  *time.Time                   `json:"chain_committed_at,omitempty"`
	ArchivedAt        *time.Time                   `json:"archived_at,omitempty"`
	ExpiredAt         *time.Time                   `json:"expired_at,omitempty"`
	LastSeenAt        *time.Time                   `json:"last_seen_at,omitempty"`
	LastMeteredAt     *time.Time                   `json:"last_metered_at,omitempty"`
	UsageSnapshot     sessionIntentUsageSnapshot   `json:"usage_snapshot"`
	BillingSnapshot   sessionIntentBillingSnapshot `json:"billing_snapshot"`
	Intent            interface{}                  `json:"intent"`
}

func persistIssuedSessionIntent(
	userID uuid.UUID,
	claims sessionintent.Claims,
) (*models.SessionIntentRecord, error) {
	intentID, err := uuid.Parse(claims.ID)
	if err != nil {
		return nil, err
	}

	var listingID *uuid.UUID
	if claims.ListingID != "" {
		parsed, parseErr := uuid.Parse(claims.ListingID)
		if parseErr != nil {
			return nil, parseErr
		}
		listingID = &parsed
	}

	record := models.SessionIntentRecord{
		ID:                      intentID,
		UserID:                  userID,
		ListingID:               listingID,
		SessionType:             models.SessionType(claims.SessionType),
		LifecycleState:          models.SessionIntentAuthorized,
		TrustTier:               claims.TrustTier,
		BandwidthLimit:          claims.BandwidthLimit,
		TargetGeo:               claims.TargetGeo,
		TargetISP:               claims.TargetISP,
		RoutingProfile:          claims.RoutingProfile,
		AllowedDomains:          pq.StringArray(claims.AllowedDomains),
		BlockedDomains:          pq.StringArray(claims.BlockedDomains),
		RotationType:            claims.RotationType,
		RotationIntervalSeconds: claims.RotationIntervalSeconds,
		TimeLimitMinutes:        claims.TimeLimitMinutes,
		PreferredTier:           claims.PreferredTier,
		RequestsPerMinute:       claims.RequestsPerMinute,
		MaxConcurrency:          claims.MaxConcurrency,
		MaxPricePerGB:           claims.MaxPricePerGB,
		ExpiresAt:               claims.ExpiresAt.Time,
	}

	if listingID != nil {
		var listing models.ProxyListing
		if err := db.DB.Select("price_per_gb").Where("id = ?", *listingID).First(&listing).Error; err == nil && listing.PricePerGB > 0 {
			record.BillingPricePerGBUSD = listing.PricePerGB
			record.BillingPriceSource = "listing"
		}
	}
	if record.BillingPricePerGBUSD == 0 && claims.MaxPricePerGB > 0 {
		record.BillingPricePerGBUSD = claims.MaxPricePerGB
		record.BillingPriceSource = "intent_cap"
	}
	if record.BillingPriceSource == "" {
		record.BillingPriceSource = "unknown"
	}

	if err := db.DB.Create(&record).Error; err != nil {
		return nil, err
	}

	return &record, nil
}

func syncSessionIntentExpiration(record *models.SessionIntentRecord) error {
	if record == nil || !canAutoExpireSessionIntent(record.LifecycleState) {
		return nil
	}
	now := time.Now().UTC()
	if now.Before(record.ExpiresAt) {
		return nil
	}

	updates := map[string]interface{}{
		"lifecycle_state": models.SessionIntentExpired,
		"expired_at":      now,
		"last_seen_at":    now,
	}
	if err := db.DB.Model(record).Updates(updates).Error; err != nil {
		return err
	}
	record.LifecycleState = models.SessionIntentExpired
	record.ExpiredAt = &now
	record.LastSeenAt = &now
	return nil
}

func canAutoExpireSessionIntent(state models.SessionIntentLifecycle) bool {
	return state.IsPreActivation()
}

func buildSessionIntentStatusResponse(record *models.SessionIntentRecord) sessionIntentStatusResponse {
	totalBytes := record.TotalBytesUp + record.TotalBytesDown
	totalGB := float64(totalBytes) / bytesPerGB
	bytesRemaining := int64(0)
	percentUsed := 0.0
	unlimited := record.BandwidthLimit <= 0
	if !unlimited {
		bytesRemaining = maxInt64(record.BandwidthLimit-totalBytes, 0)
		if record.BandwidthLimit > 0 {
			percentUsed = (float64(totalBytes) / float64(record.BandwidthLimit)) * 100
		}
	}
	unitPriceUSD, priceSource := resolveIntentUnitPrice(record)
	unitPriceSOL := 0.0
	estimatedCostUSD := 0.0
	estimatedCostSOL := 0.0
	projectedLimitCostUSD := 0.0
	projectedLimitCostSOL := 0.0
	if unitPriceUSD > 0 {
		unitPriceSOL = billing.USDToSOL(unitPriceUSD)
		estimatedCostUSD = totalGB * unitPriceUSD
		estimatedCostSOL = billing.USDToSOL(estimatedCostUSD)
		if !unlimited {
			projectedLimitCostUSD = (float64(record.BandwidthLimit) / bytesPerGB) * unitPriceUSD
			projectedLimitCostSOL = billing.USDToSOL(projectedLimitCostUSD)
		}
	}

	return sessionIntentStatusResponse{
		LifecycleState:    string(record.LifecycleState),
		ExpiresAt:         record.ExpiresAt,
		CreatedAt:         record.CreatedAt,
		UpdatedAt:         record.UpdatedAt,
		RoutedAt:          record.RoutedAt,
		ActivatedAt:       record.ActivatedAt,
		ClosingAt:         record.ClosingAt,
		LedgerCommittedAt: record.LedgerCommittedAt,
		BatchedAt:         record.BatchedAt,
		ChainCommittedAt:  record.ChainCommittedAt,
		ArchivedAt:        record.ArchivedAt,
		ExpiredAt:         record.ExpiredAt,
		LastSeenAt:        record.LastSeenAt,
		LastMeteredAt:     record.LastMeteredAt,
		UsageSnapshot: sessionIntentUsageSnapshot{
			TotalBytes:         totalBytes,
			TotalBytesUp:       record.TotalBytesUp,
			TotalBytesDown:     record.TotalBytesDown,
			LastBytesUpDelta:   record.LastBytesUpDelta,
			LastBytesDownDelta: record.LastBytesDownDelta,
			TotalGB:            totalGB,
			PercentUsed:        math.Min(percentUsed, 100),
			BytesRemaining:     bytesRemaining,
			Unlimited:          unlimited,
		},
		BillingSnapshot: sessionIntentBillingSnapshot{
			Currency:              "USD",
			PriceSource:           priceSource,
			UnitPriceUSDPerGB:     unitPriceUSD,
			UnitPriceSOLPerGB:     unitPriceSOL,
			EstimatedCostUSD:      estimatedCostUSD,
			EstimatedCostSOL:      estimatedCostSOL,
			ProjectedLimitCostUSD: projectedLimitCostUSD,
			ProjectedLimitCostSOL: projectedLimitCostSOL,
		},
		Intent: gin.H{
			"intent_id":                 record.ID,
			"user_id":                   record.UserID,
			"listing_id":                record.ListingID,
			"session_type":              record.SessionType,
			"trust_tier":                record.TrustTier,
			"bandwidth_limit":           record.BandwidthLimit,
			"target_geo":                record.TargetGeo,
			"target_isp":                record.TargetISP,
			"routing_profile":           record.RoutingProfile,
			"allowed_domains":           []string(record.AllowedDomains),
			"blocked_domains":           []string(record.BlockedDomains),
			"rotation_type":             record.RotationType,
			"rotation_interval_seconds": record.RotationIntervalSeconds,
			"time_limit_minutes":        record.TimeLimitMinutes,
			"preferred_tier":            record.PreferredTier,
			"requests_per_minute":       record.RequestsPerMinute,
			"max_concurrency":           record.MaxConcurrency,
			"max_price_per_gb":          record.MaxPricePerGB,
			"billing_price_per_gb_usd":  record.BillingPricePerGBUSD,
			"billing_price_source":      record.BillingPriceSource,
			"provider_node_id":          record.ProviderNodeID,
			"target_host":               record.TargetHost,
			"total_bytes_up":            record.TotalBytesUp,
			"total_bytes_down":          record.TotalBytesDown,
			"last_bytes_up_delta":       record.LastBytesUpDelta,
			"last_bytes_down_delta":     record.LastBytesDownDelta,
			"usage_update_count":        record.UsageUpdateCount,
		},
	}
}

func getSessionIntent(c *gin.Context) {
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
	if err := db.DB.Preload("Listing").Where("id = ? AND user_id = ? AND deleted_at IS NULL", intentID, userID).First(&record).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session intent not found"})
		return
	}

	if err := syncSessionIntentExpiration(&record); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refresh session intent state"})
		return
	}

	c.JSON(http.StatusOK, buildSessionIntentStatusResponse(&record))
}

func listSessionIntents(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var records []models.SessionIntentRecord
	if err := db.DB.Preload("Listing").Where("user_id = ? AND deleted_at IS NULL", userID).
		Order("created_at DESC").
		Limit(20).
		Find(&records).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list session intents"})
		return
	}

	responses := make([]sessionIntentStatusResponse, 0, len(records))
	for index := range records {
		record := &records[index]
		if err := syncSessionIntentExpiration(record); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refresh session intent state"})
			return
		}
		responses = append(responses, buildSessionIntentStatusResponse(record))
	}

	c.JSON(http.StatusOK, gin.H{"intents": responses})
}

func resolveIntentUnitPrice(record *models.SessionIntentRecord) (float64, string) {
	if record != nil && record.BillingPricePerGBUSD > 0 {
		priceSource := record.BillingPriceSource
		if priceSource == "" {
			priceSource = "snapshot"
		}
		return record.BillingPricePerGBUSD, priceSource
	}
	if record != nil && record.Listing != nil && record.Listing.PricePerGB > 0 {
		return record.Listing.PricePerGB, "listing"
	}
	if record != nil && record.MaxPricePerGB > 0 {
		return record.MaxPricePerGB, "intent_cap"
	}
	return 0, "unpriced"
}

func maxInt64(a int64, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
