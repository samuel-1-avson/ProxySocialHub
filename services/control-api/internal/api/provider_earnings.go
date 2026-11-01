package api

import (
	"net/http"
	"strconv"
	"strings"
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
	rg.POST("/provider/earnings/claim", RateLimitMiddleware(), claimProviderEarnings)
	rg.GET("/provider/earnings/payout-settings", getPayoutSettings)
	rg.PUT("/provider/earnings/payout-settings", updatePayoutSettings)
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
		// W-10 payable sub-balance (claimable now).
		PayableLamports            int64   `json:"payable_lamports"`
		PayableSOL                 float64 `json:"payable_sol"`
		AutoPayoutEnabled          bool    `json:"auto_payout_enabled"`
		AutoPayoutThresholdLamports int64  `json:"auto_payout_threshold_lamports"`
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

	var wallet models.Wallet
	if err := db.DB.Select("earnings_payable_lamports", "balance_lamports", "auto_payout_enabled", "auto_payout_threshold_lamports").
		Where("user_id = ?", userID).First(&wallet).Error; err == nil {
		result.PayableLamports = wallet.PayableLamports()
		result.PayableSOL = models.LamportsToSOL(uint64(wallet.PayableLamports()))
		result.AutoPayoutEnabled = wallet.AutoPayoutEnabled
		result.AutoPayoutThresholdLamports = wallet.AutoPayoutThresholdOrDefault()
	}

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

// recordProviderEarning is called after a session ends to create the earning record
// (bookkeeping for the provider dashboard). platformFeePercent is a value 0.0–1.0.
//
// It does not move money. BE-CRIT-02: it used to also queue a direct on-chain payout for
// non-escrow sessions, but those sessions are already paid elsewhere, so the provider
// was paid twice:
//   - custodial sessions: billing.settleSession credits the provider's wallet balance, and
//     the balance is paid out (and debited) once it passes the payout threshold;
//   - session-escrow sessions: settle_session_escrow pays the seller on-chain;
//   - order escrow sessions: anchorUsageProofAndSettle settles the escrow on-chain.
//
// The row starts "pending" and is marked "paid" when one of those paths pays or credits
// the provider (see billing.markProviderEarningPaid and finalizeProviderPayoutAfterSettle).
type claimEarningsRequest struct {
	AmountLamports int64   `json:"amount_lamports"`
	Amount         float64 `json:"amount"` // deprecated SOL float; amount_lamports wins
	IdempotencyKey string  `json:"idempotency_key"`
}

// POST /v1/provider/earnings/claim - manual claim of payable earnings
// (W-10 default payout mode). Atomic debit+enqueue via billing.
func claimProviderEarnings(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	// W-34: uniform freeze on payout claims.
	if frozen, ferr := models.UserFrozen(db.DB, userID); ferr != nil || frozen {
		c.JSON(http.StatusForbidden, gin.H{"error": "Account is flagged and payout claims are frozen pending security review."})
		return
	}
	var req claimEarningsRequest
	if err := c.ShouldBindJSON(&req); err != nil && err.Error() != "EOF" {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	lamports := req.AmountLamports
	if lamports == 0 && req.Amount > 0 {
		lamports = int64(models.SOLToLamports(req.Amount))
	}
	if lamports < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "amount_lamports must be >= 0 (0 claims all payable)"})
		return
	}

	idemKey := clientIdempotencyKey(c, req.IdempotencyKey)
	if replayStoredIdempotent(c, userID, models.IdempotencyEndpointEarningsClaim, idemKey) {
		return
	}
	if idemKey != "" {
		rec := models.IdempotencyRecord{UserID: userID, Endpoint: models.IdempotencyEndpointEarningsClaim, IdempotencyKey: idemKey}
		if err := db.DB.Create(&rec).Error; err != nil {
			if replayStoredIdempotent(c, userID, models.IdempotencyEndpointEarningsClaim, idemKey) {
				return
			}
			c.JSON(http.StatusConflict, gin.H{"error": "Duplicate request in progress", "status": "in_progress"})
			return
		}
		defer func() {
			// On failure the money never moved: release the claim so the
			// client can retry with the same key.
			if c.Writer.Status() >= 400 {
				db.DB.Where("user_id = ? AND endpoint = ? AND idempotency_key = ?", userID, models.IdempotencyEndpointEarningsClaim, idemKey).
					Delete(&models.IdempotencyRecord{})
			}
		}()
	}

	payoutID, paidLamports, err := billing.QueueProviderPayoutAmount(userID, lamports)
	if err != nil {
		status := http.StatusInternalServerError
		msg := err.Error()
		if containsAny(msg, "no earnings payable", "payable balance", "no payable wallet") {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": msg})
		return
	}
	body := gin.H{
		"status":          "queued",
		"amount_lamports": paidLamports,
		"amount_sol":      models.LamportsToSOL(uint64(paidLamports)),
	}
	if payoutID != uuid.Nil {
		body["payout_id"] = payoutID.String()
	}
	if idemKey != "" {
		db.DB.Model(&models.IdempotencyRecord{}).
			Where("user_id = ? AND endpoint = ? AND idempotency_key = ?", userID, models.IdempotencyEndpointEarningsClaim, idemKey).
			Update("reference", payoutID.String())
		storeIdempotentResponse(userID, models.IdempotencyEndpointEarningsClaim, idemKey, http.StatusAccepted, body)
	}
	c.JSON(http.StatusAccepted, body)
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

type payoutSettingsRequest struct {
	AutoPayoutEnabled           *bool  `json:"auto_payout_enabled"`
	AutoPayoutThresholdLamports *int64 `json:"auto_payout_threshold_lamports"`
}

func loadPayoutWallet(c *gin.Context) (*models.Wallet, bool) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return nil, false
	}
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", userID).First(&wallet).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "wallet not found"})
		return nil, false
	}
	return &wallet, true
}

// GET /v1/provider/earnings/payout-settings
func getPayoutSettings(c *gin.Context) {
	wallet, ok := loadPayoutWallet(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"auto_payout_enabled":            wallet.AutoPayoutEnabled,
		"auto_payout_threshold_lamports": wallet.AutoPayoutThresholdOrDefault(),
		"payable_lamports":               wallet.PayableLamports(),
		"payable_sol":                    models.LamportsToSOL(uint64(wallet.PayableLamports())),
	})
}

// PUT /v1/provider/earnings/payout-settings
func updatePayoutSettings(c *gin.Context) {
	wallet, ok := loadPayoutWallet(c)
	if !ok {
		return
	}
	var req payoutSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	updates := map[string]interface{}{}
	if req.AutoPayoutEnabled != nil {
		updates["auto_payout_enabled"] = *req.AutoPayoutEnabled
		wallet.AutoPayoutEnabled = *req.AutoPayoutEnabled
	}
	if req.AutoPayoutThresholdLamports != nil {
		if *req.AutoPayoutThresholdLamports < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "auto_payout_threshold_lamports must be >= 0"})
			return
		}
		updates["auto_payout_threshold_lamports"] = *req.AutoPayoutThresholdLamports
		wallet.AutoPayoutThresholdLamports = *req.AutoPayoutThresholdLamports
	}
	if len(updates) > 0 {
		if err := db.DB.Model(wallet).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save payout settings"})
			return
		}
	}
	// Enabling auto-payout with payable at/over threshold pays out now.
	if wallet.AutoPayoutEnabled && wallet.PayableLamports() >= wallet.AutoPayoutThresholdOrDefault() && wallet.PayableLamports() > 0 {
		go func(uid uuid.UUID) {
			_, _, _ = billing.QueueProviderPayoutAmount(uid, 0)
		}(wallet.UserID)
	}
	c.JSON(http.StatusOK, gin.H{
		"auto_payout_enabled":            wallet.AutoPayoutEnabled,
		"auto_payout_threshold_lamports": wallet.AutoPayoutThresholdOrDefault(),
		"payable_lamports":               wallet.PayableLamports(),
	})
}

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
	// The billing worker may have credited the provider before this row existed.
	if !escrowBacked && sessionCreditedToProviderWallet(session.ID) {
		paidAt := time.Now().UTC()
		earning.Status = "paid"
		earning.PaidAt = &paidAt
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

}

// sessionCreditedToProviderWallet reports whether billing.settleSession has already
// credited the provider's wallet for this session: ledger reference "<session>:provider"
// (before W-29) or "<session>:provider:<claim>" (one per settlement since).
func sessionCreditedToProviderWallet(sessionID uuid.UUID) bool {
	var n int64
	db.DB.Model(&models.WalletLedgerEntry{}).
		Where("(reference_id = ? OR reference_id LIKE ?) AND type = ?",
			sessionID.String()+":provider", sessionID.String()+":provider:%", "provider_earning").
		Count(&n)
	return n > 0
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
