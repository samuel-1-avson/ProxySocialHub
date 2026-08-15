package api

import (
	"net/http"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/prices"
	"github.com/proxyhubb/control-api/internal/solana"
)

const (
	paymentMethodSessionEscrow        = "solana_session_escrow"
	paymentMethodSessionEscrowPending = "solana_session_escrow_pending"
)

// fundSessionIntentSolana records SessionEscrow PDA params for a gateway intent (mirrors Phase 1b).
func fundSessionIntentSolana(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	intentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid intent ID"})
		return
	}

	var intent models.SessionIntentRecord
	if err := db.DB.Preload("Listing").Where("id = ? AND deleted_at IS NULL", intentID).First(&intent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session intent not found"})
		return
	}
	if intent.UserID != userUUID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not your session intent"})
		return
	}
	if intent.LifecycleState.IsTerminal() {
		c.JSON(http.StatusConflict, gin.H{"error": "Intent is terminal", "status": intent.LifecycleState})
		return
	}

	var buyerWallet models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", userUUID, models.ChainSolana).
		First(&buyerWallet).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Please link a Solana wallet first", "code": "linked_wallet_required"})
		return
	}

	sellerAddr := intent.SellerWallet
	pricePerGB := intent.BillingPricePerGBUSD
	if pricePerGB <= 0 {
		pricePerGB = intent.MaxPricePerGB
	}
	if sellerAddr == "" || pricePerGB <= 0 {
		if intent.Listing != nil {
			if pricePerGB <= 0 {
				pricePerGB = intent.Listing.PricePerGB
			}
			if sellerAddr == "" {
				var lw models.LinkedWallet
				if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", intent.Listing.SellerID, models.ChainSolana).
					First(&lw).Error; err == nil {
					sellerAddr = lw.Address
				}
			}
		}
		if sellerAddr == "" && intent.ProviderNodeID != "" {
			if pnID, err := uuid.Parse(intent.ProviderNodeID); err == nil {
				var pn models.ProviderNode
				if err := db.DB.First(&pn, "id = ?", pnID).Error; err == nil {
					sellerAddr = pn.Hotkey
					if pricePerGB <= 0 {
						pricePerGB = pn.BasePricePerGB
					}
					if sellerAddr == "" {
						var lw models.LinkedWallet
						if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", pn.UserID, models.ChainSolana).
							First(&lw).Error; err == nil {
							sellerAddr = lw.Address
						}
					}
				}
			}
		}
	}
	if pricePerGB <= 0 {
		pricePerGB = 0.99
	}
	if sellerAddr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Provider has no Solana wallet", "code": "seller_wallet_required"})
		return
	}

	buyerPub, err := sol.PublicKeyFromBase58(buyerWallet.Address)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid buyer wallet"})
		return
	}
	sellerPub, err := sol.PublicKeyFromBase58(sellerAddr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid seller wallet"})
		return
	}
	oracle := solana.GetOracle()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Solana Oracle not configured"})
		return
	}

	var sidBytes [16]byte
	copy(sidBytes[:], intent.ID[:])
	pda, _, err := oracle.GetSessionEscrowPDA(sidBytes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to derive session escrow PDA"})
		return
	}

	solPrice, err := prices.GetSOLPrice(c.Request.Context())
	if err != nil || solPrice <= 0 {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Failed to fetch SOL price"})
		return
	}

	bw := intent.BandwidthLimit
	if bw <= 0 {
		bw = 1 * 1024 * 1024 * 1024
	}
	bwGB := float64(bw) / (1024 * 1024 * 1024)
	amountUSD := bwGB * pricePerGB
	amountSOL := amountUSD / solPrice
	amountLamports := models.SOLToLamports(amountSOL)
	if amountLamports == 0 {
		amountLamports = 1_000_000
	}
	pricePerGBLamports := models.SOLToLamports(pricePerGB / solPrice)
	expiresAt := intent.ExpiresAt.Unix()
	if expiresAt <= time.Now().Unix() {
		expiresAt = time.Now().Add(24 * time.Hour).Unix()
	}

	updates := map[string]interface{}{
		// Pending until confirm-escrow proves on-chain SessionEscrow (W1.1).
		"payment_method":           paymentMethodSessionEscrowPending,
		"session_pda":              pda.String(),
		"buyer_wallet":             buyerWallet.Address,
		"seller_wallet":            sellerAddr,
		"amount_locked_sol":        amountSOL,
		"billing_price_per_gb_usd": pricePerGB,
		"bandwidth_limit":          bw,
		"escrow_confirmed_at":      nil,
	}
	if err := db.DB.Model(&intent).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update session intent"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"program_id":            solana.ProgramID,
		"session_pda":           pda.String(),
		"intent_id":             intent.ID.String(),
		"buyer_pubkey":          buyerPub.String(),
		"seller_pubkey":         sellerPub.String(),
		"amount_lamports":       amountLamports,
		"amount_sol":            amountSOL,
		"bandwidth_limit_bytes": bw,
		"price_per_gb_lamports": pricePerGBLamports,
		"expires_at":            expiresAt,
		"oracle_pubkey":         oracle.GetOraclePublicKey().String(),
	})
}

// confirmSessionIntentEscrow marks intent funded after on-chain initialize_session_escrow.
func confirmSessionIntentEscrow(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	intentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid intent ID"})
		return
	}

	var intent models.SessionIntentRecord
	if err := db.DB.Where("id = ? AND deleted_at IS NULL", intentID).First(&intent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session intent not found"})
		return
	}
	if intent.UserID != userUUID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not your session intent"})
		return
	}

	if intent.SessionPDA == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "session has no session_pda; complete POST .../fund/solana first",
			"code":  "session_pda_required",
		})
		return
	}

	oracle := solana.GetOracle()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Solana Oracle not configured"})
		return
	}
	pda, err := sol.PublicKeyFromBase58(intent.SessionPDA)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session_pda"})
		return
	}
	escrow, err := oracle.FetchSessionEscrow(c.Request.Context(), pda)
	if err != nil || escrow == nil {
		c.JSON(http.StatusConflict, gin.H{
			"error":       "On-chain session escrow not found. Complete initialize_session_escrow first.",
			"code":        "session_escrow_missing",
			"session_pda": intent.SessionPDA,
		})
		return
	}

	status := escrow.Status.String()
	if escrow.Status != solana.EscrowPending && escrow.Status != solana.EscrowActive {
		c.JSON(http.StatusConflict, gin.H{
			"error":           "On-chain session escrow is not active",
			"on_chain_status": status,
			"code":            "session_escrow_terminal",
		})
		return
	}

	now := time.Now().UTC()
	if err := db.DB.Model(&intent).Updates(map[string]interface{}{
		"payment_method":      paymentMethodSessionEscrow,
		"escrow_confirmed_at": now,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to mark session intent escrow confirmed"})
		return
	}
	_ = db.DB.Where("id = ?", intentID).First(&intent)

	c.JSON(http.StatusOK, gin.H{
		"intent":          intent,
		"on_chain_status": status,
		"amount_lamports": escrow.Amount,
		"session_pda":     intent.SessionPDA,
	})
}

// intentRequiresFundedSessionPDA is true when Active must be blocked because
// PROXYHUB_REQUIRE_SESSION_PDA is on and confirm-escrow has not succeeded.
func intentRequiresFundedSessionPDA(intent *models.SessionIntentRecord) bool {
	if intent == nil || !decentralization.RequireSessionPDAEnabled() {
		return false
	}
	if intent.EscrowConfirmedAt == nil {
		return true
	}
	if intent.SessionPDA == "" {
		return true
	}
	if intent.PaymentMethod != paymentMethodSessionEscrow {
		return true
	}
	return false
}
