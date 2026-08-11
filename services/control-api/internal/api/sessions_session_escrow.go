package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/prices"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/solana"
)

// fundSessionSolana records the session escrow PDA intent (Phase 1b).
// Client must call initialize_session_escrow then confirm-escrow.
func fundSessionSolana(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session ID"})
		return
	}

	var session models.Session
	if err := db.DB.First(&session, "id = ?", sessionID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}
	if session.UserID != userUUID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not your session"})
		return
	}
	if session.Status != models.SessionPendingPayment && session.Status != models.SessionActivationPending {
		c.JSON(http.StatusConflict, gin.H{"error": "Session is not awaiting escrow funding", "status": session.Status})
		return
	}

	var buyerWallet models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", userUUID, models.ChainSolana).
		First(&buyerWallet).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Please link a Solana wallet first", "code": "linked_wallet_required"})
		return
	}

	sellerAddr := session.SellerWallet
	pricePerGB := session.MaxPrice
	if sellerAddr == "" || pricePerGB <= 0 {
		if session.NodeID == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Session has no provider node"})
			return
		}
		var providerNode models.ProviderNode
		if err := db.DB.First(&providerNode, "id = ?", *session.NodeID).Error; err != nil {
			// Fallback: legacy nodes mirror
			var node models.Node
			if err2 := db.DB.First(&node, "id = ?", *session.NodeID).Error; err2 != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Provider node not found"})
				return
			}
			if sellerAddr == "" {
				sellerAddr = node.Hotkey
			}
			if pricePerGB <= 0 {
				pricePerGB = node.BasePricePerGB
			}
			if sellerAddr == "" {
				var lw models.LinkedWallet
				if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", node.UserID, models.ChainSolana).
					First(&lw).Error; err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": "Provider has no Solana wallet"})
					return
				}
				sellerAddr = lw.Address
			}
		} else {
			if sellerAddr == "" {
				sellerAddr = providerNode.Hotkey
			}
			if pricePerGB <= 0 {
				pricePerGB = providerNode.BasePricePerGB
			}
			if sellerAddr == "" {
				var lw models.LinkedWallet
				if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", providerNode.UserID, models.ChainSolana).
					First(&lw).Error; err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": "Provider has no Solana wallet"})
					return
				}
				sellerAddr = lw.Address
			}
		}
	}
	if pricePerGB <= 0 {
		pricePerGB = 0.99
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
	copy(sidBytes[:], session.ID[:])
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

	bwGB := float64(session.BandwidthLimit) / (1024 * 1024 * 1024)
	if bwGB <= 0 {
		bwGB = 1
	}
	amountUSD := bwGB * pricePerGB
	amountSOL := amountUSD / solPrice
	amountLamports := models.SOLToLamports(amountSOL)
	if amountLamports == 0 {
		amountLamports = 1_000_000 // 0.001 SOL floor
	}
	pricePerGBLamports := models.SOLToLamports(pricePerGB / solPrice)

	expiresAt := time.Now().Add(24 * time.Hour).Unix()
	if session.ExpiresAt != nil {
		expiresAt = session.ExpiresAt.Unix()
	}

	updates := map[string]interface{}{
		"payment_method":    "solana_session_escrow",
		"session_pda":       pda.String(),
		"buyer_wallet":      buyerWallet.Address,
		"seller_wallet":     sellerAddr,
		"amount_locked_sol": amountSOL,
		"max_price":         pricePerGB,
	}
	if err := db.DB.Model(&session).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update session"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"program_id":            solana.ProgramID,
		"session_pda":           pda.String(),
		"session_id":            session.ID.String(),
		"buyer_pubkey":          buyerPub.String(),
		"seller_pubkey":         sellerPub.String(),
		"amount_lamports":       amountLamports,
		"amount_sol":            amountSOL,
		"bandwidth_limit_bytes": session.BandwidthLimit,
		"price_per_gb_lamports": pricePerGBLamports,
		"expires_at":            expiresAt,
		"oracle_pubkey":         oracle.GetOraclePublicKey().String(),
	})
}

// confirmSessionEscrow activates a pending_payment session after on-chain fund.
func confirmSessionEscrow(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session ID"})
		return
	}

	var session models.Session
	if err := db.DB.First(&session, "id = ?", sessionID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}
	if session.UserID != userUUID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not your session"})
		return
	}

	if session.Status == models.SessionActive {
		c.JSON(http.StatusOK, gin.H{"session": session, "already_active": true})
		return
	}

	if session.Status != models.SessionPendingPayment && session.Status != models.SessionActivationPending {
		c.JSON(http.StatusConflict, gin.H{"error": "Session is not awaiting escrow confirmation", "status": session.Status})
		return
	}

	if decentralization.RequireSessionPDAEnabled() && session.SessionPDA == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "PROXYHUB_REQUIRE_SESSION_PDA: session has no session_pda; complete POST .../fund/solana first",
			"code":  "session_pda_required",
		})
		return
	}

	oracle := solana.GetOracle()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Solana Oracle not configured"})
		return
	}

	var sidBytes [16]byte
	copy(sidBytes[:], session.ID[:])
	pda, _, err := oracle.GetSessionEscrowPDA(sidBytes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to derive PDA"})
		return
	}

	escrow, err := oracle.FetchSessionEscrow(c.Request.Context(), pda)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{
			"error":       "On-chain session escrow not found. Complete initialize_session_escrow first.",
			"session_pda": pda.String(),
			"code":        "session_escrow_missing",
		})
		return
	}
	if escrow.Status != solana.EscrowPending && escrow.Status != solana.EscrowActive {
		c.JSON(http.StatusConflict, gin.H{
			"error":           "On-chain session escrow is not active",
			"on_chain_status": escrow.Status.String(),
			"code":            "session_escrow_terminal",
		})
		return
	}
	if escrow.Amount == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "On-chain session escrow has no locked funds", "code": "session_escrow_empty"})
		return
	}

	if err := db.DB.Model(&session).Updates(map[string]interface{}{
		"status":            models.SessionActive,
		"session_pda":       pda.String(),
		"payment_method":    "solana_session_escrow",
		"amount_locked_sol": float64(escrow.Amount) / 1e9,
		"buyer_wallet":      escrow.Buyer.String(),
		"seller_wallet":     escrow.Seller.String(),
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to activate session"})
		return
	}
	_ = db.DB.First(&session, "id = ?", session.ID)

	providerID := ""
	pricePerGB := session.MaxPrice
	if session.NodeID != nil {
		var providerNode models.ProviderNode
		if err := db.DB.First(&providerNode, "id = ?", *session.NodeID).Error; err == nil {
			providerID = providerNode.UserID.String()
			if pricePerGB <= 0 {
				pricePerGB = providerNode.BasePricePerGB
			}
		}
	}
	if session.CredentialsUser != "" {
		credHash := ""
		if session.CredentialsPass != "" {
			credHash = marketplace.HashCredentialPassword(session.CredentialsPass)
		}
		sessionData := &redisClient.SessionData{
			UserID:                 session.UserID.String(),
			ProviderID:             providerID,
			SessionID:              session.ID.String(),
			Type:                   "universal",
			Status:                 "active",
			BandwidthLimit:         session.BandwidthLimit,
			TrustTier:              "verified",
			ExpiresAt:              time.Now().Add(24 * time.Hour),
			CreatedAt:              time.Now(),
			PricePerGB:             pricePerGB,
			CredentialPasswordHash: credHash,
		}
		_ = redisClient.StoreSession(session.CredentialsUser, sessionData, 24*time.Hour)
	}

	c.JSON(http.StatusOK, gin.H{
		"session":         session,
		"session_pda":     pda.String(),
		"on_chain_status": escrow.Status.String(),
		"amount_lamports": escrow.Amount,
	})
}
