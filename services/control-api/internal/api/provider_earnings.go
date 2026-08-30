package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/incentives"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// RegisterProviderEarningsRoutes wires earnings endpoints onto the protected group.
func RegisterProviderEarningsRoutes(rg *gin.RouterGroup) {
	rg.GET("/provider/earnings", getProviderEarnings)
	rg.GET("/provider/earnings/summary", getProviderEarningsSummary)
	rg.GET("/provider/earnings/history", getProviderPayoutHistory)
}

// GET /v1/provider/earnings/summary
func getProviderEarningsSummary(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	type summary struct {
		TotalEarnedSOL   float64 `json:"total_earned_sol"`
		PendingSOL       float64 `json:"pending_sol"`
		PaidSOL          float64 `json:"paid_sol"`
		TotalSessions    int64   `json:"total_sessions"`
		TotalBandwidthGB float64 `json:"total_bandwidth_gb"`
		Last30DaysSOL    float64 `json:"last_30_days_sol"`
		Last7DaysSOL     float64 `json:"last_7_days_sol"`
	}

	var result summary
	db.DB.Model(&models.ProviderEarning{}).
		Where("provider_user_id = ? AND deleted_at IS NULL", userID).
		Select(`
			COALESCE(SUM(net_amount_sol), 0)                                                        AS total_earned_sol,
			COALESCE(SUM(CASE WHEN status = 'pending' THEN net_amount_sol ELSE 0 END), 0)           AS pending_sol,
			COALESCE(SUM(CASE WHEN status = 'paid'    THEN net_amount_sol ELSE 0 END), 0)           AS paid_sol,
			COUNT(*)                                                                                  AS total_sessions,
			COALESCE(SUM(bandwidth_gb), 0)                                                          AS total_bandwidth_gb
		`).Scan(&result)

	db.DB.Model(&models.ProviderEarning{}).
		Where("provider_user_id = ? AND created_at > ? AND deleted_at IS NULL", userID, time.Now().AddDate(0, 0, -30)).
		Select("COALESCE(SUM(net_amount_sol), 0)").Scan(&result.Last30DaysSOL)

	db.DB.Model(&models.ProviderEarning{}).
		Where("provider_user_id = ? AND created_at > ? AND deleted_at IS NULL", userID, time.Now().AddDate(0, 0, -7)).
		Select("COALESCE(SUM(net_amount_sol), 0)").Scan(&result.Last7DaysSOL)

	c.JSON(http.StatusOK, result)
}

// GET /v1/provider/earnings?page=1&limit=20
func getProviderEarnings(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}

	var earnings []models.ProviderEarning
	var total int64

	db.DB.Model(&models.ProviderEarning{}).
		Where("provider_user_id = ? AND deleted_at IS NULL", userID).
		Count(&total)

	db.DB.Where("provider_user_id = ? AND deleted_at IS NULL", userID).
		Order("created_at DESC").
		Offset((page - 1) * limit).
		Limit(limit).
		Find(&earnings)

	c.JSON(http.StatusOK, gin.H{
		"earnings": earnings,
		"total":    total,
		"page":     page,
		"limit":    limit,
	})
}

// GET /v1/provider/earnings/history — completed payouts with tx_hash
func getProviderPayoutHistory(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var payouts []models.ProviderEarning
	db.DB.Where("provider_user_id = ? AND status = 'paid' AND deleted_at IS NULL", userID).
		Order("paid_at DESC").
		Limit(100).
		Find(&payouts)

	c.JSON(http.StatusOK, gin.H{"payouts": payouts})
}

// recordProviderEarning is called after a session ends to create an earning record
// and queue a payout for the provider. platformFeePercent is a value 0.0–1.0.
//
// For sessions backed by an on-chain escrow (order.EscrowPDA != ""), the SOL
// transfer is executed by anchorUsageProofAndSettle via SettleEscrow — the
// chain settlement IS the payout.  In that case we create the earning row as
// "pending" (it will be updated to "paid" by anchorUsageProofAndSettle once the
// settle tx confirms) but intentionally skip the DB batch-payout queue so the
// provider is not paid twice.
func recordProviderEarning(session models.Session, bandwidthUsedBytes int64, pricePerGB float64, platformFeePercent float64) {
	if bandwidthUsedBytes <= 0 {
		return
	}

	node, err := marketplace.ResolveProviderNodeForSession(session)
	if err != nil || node == nil {
		logging.Warn().
			Err(err).
			Str("session_id", session.ID.String()).
			Msg("recordProviderEarning: could not resolve provider node")
		return
	}

	bandwidthGB := float64(bandwidthUsedBytes) / (1024 * 1024 * 1024)
	grossSOL := bandwidthGB * pricePerGB
	var linkedOrder models.Order
	escrowBacked := false
	if err := db.DB.Select("escrow_pda, price_per_gb").Where("session_id = ?", session.ID).First(&linkedOrder).Error; err == nil {
		escrowBacked = linkedOrder.EscrowPDA != ""
		if linkedOrder.PricePerGB > 0 {
			if _, _, costSOL := billing.CostFromBytesUSD(bandwidthUsedBytes, linkedOrder.PricePerGB); costSOL > 0 {
				grossSOL = costSOL
			}
		}
	}
	if grossSOL < 0 {
		grossSOL = 0
	}

	// Escrow PDA settle pays the full proportional seller share on-chain with no
	// treasury skim. Keep PlatformFeeSOL at 0 for those rows so DB matches chain.
	if escrowBacked {
		platformFeePercent = 0
	}

	multiplier := node.GetEarningsMultiplier()
	platformFeeSOL := grossSOL * platformFeePercent
	netSOL := (grossSOL - platformFeeSOL) * multiplier

	earning := models.ProviderEarning{
		ProviderUserID:     node.UserID,
		NodeID:             node.ID,
		SessionID:          session.ID,
		BandwidthGB:        bandwidthGB,
		GrossAmountSOL:     grossSOL,
		PlatformFeeSOL:     platformFeeSOL,
		NetAmountSOL:       netSOL,
		EarningsMultiplier: multiplier,
		PricePerGB:         pricePerGB,
		Status:             "pending",
	}

	if err := db.DB.Create(&earning).Error; err != nil {
		logging.Warn().
			Err(err).
			Str("session_id", session.ID.String()).
			Msg("recordProviderEarning: create failed")
		return
	}

	// Wave 4.3/5.C.4: observe ledger; settle mode may dual-gate provider-share SendSOL.
	_ = incentives.ObserveSettlement(incentives.SettlementInput{
		SessionID:      session.ID,
		ProviderUserID: node.UserID,
		NodeID:         node.ID,
		GrossSOL:       grossSOL,
	})

	// If escrow-backed, anchorUsageProofAndSettle handles the SOL transfer — skip
	// the batch-payout queue to avoid paying the provider twice.
	if !escrowBacked && node.WalletAddress != "" {
		if bp := GetBatchPayoutProcessor(); bp != nil {
			_ = bp.QueuePayout(node.UserID, node.WalletAddress, netSOL, []string{session.ID.String()})
		}
	}
}

// GetBatchPayoutProcessor returns the global batch payout processor if registered.
// Returns nil if billing is not initialised (non-fatal — payout queued on next cycle).
var globalBatchProcessor interface {
	QueuePayout(providerID uuid.UUID, walletAddress string, amountSOL float64, sessionIDs []string) error
}

func SetBatchPayoutProcessor(bp interface {
	QueuePayout(providerID uuid.UUID, walletAddress string, amountSOL float64, sessionIDs []string) error
}) {
	globalBatchProcessor = bp
}

func GetBatchPayoutProcessor() interface {
	QueuePayout(providerID uuid.UUID, walletAddress string, amountSOL float64, sessionIDs []string) error
} {
	return globalBatchProcessor
}

// ensureNoEarningDuplicate is a helper guard used in tests.
func ensureNoEarningDuplicate(sessionID uuid.UUID) bool {
	var count int64
	db.DB.Model(&models.ProviderEarning{}).
		Where("session_id = ? AND deleted_at IS NULL", sessionID).
		Count(&count)
	return count == 0
}

// Satisfy gorm import usage
var _ = gorm.ErrRecordNotFound
