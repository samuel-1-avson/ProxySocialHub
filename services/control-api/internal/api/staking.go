package api

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/token"
)

// RegisterStakingRoutes registers node staking routes
func RegisterStakingRoutes(rg *gin.RouterGroup) {
	rg.POST("/staking/node/stake", stakeNode)
	rg.POST("/staking/node/unstake", unstakeNode)

	// PHB token staking — providers stake PHB to boost node quality / governance weight.
	// On-chain PHB balance is verified; tokens stay in the provider's wallet until
	// Phase 5 (Solana vault escrow). The stake position is recorded in the DB.
	rg.POST("/staking/phb/stake", stakePHB)
	rg.POST("/staking/phb/unstake", unstakePHB)
}

type stakeNodeRequest struct {
	AmountSOL float64   `json:"amount_sol" binding:"required,gt=0"`
	ListingID uuid.UUID `json:"listing_id" binding:"required"`
}

type unstakeNodeRequest struct {
	ListingID uuid.UUID `json:"listing_id" binding:"required"`
}

func rejectCentralizedStakingWhenFull(c *gin.Context) bool {
	if !decentralization.FullModeEnabled() {
		return false
	}

	c.JSON(http.StatusServiceUnavailable, gin.H{
		"error": "off-chain staking endpoints are disabled in FULL_DECENTRALIZATION mode; submit staking transactions on-chain",
	})
	return true
}

// stakeNode boosts a listing's priority by staking SOL on its backing node
func stakeNode(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeChainAuthoritative, "write", "mirror")

	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	sellerID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req stakeNodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify listing belongs to caller
	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ? AND seller_id = ?", req.ListingID, sellerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found or not owned by you"})
		return
	}

	// Resolve provider's linked wallet (required for stake PDA ownership).
	var user models.User
	if err := db.DB.Select("wallet_address").First(&user, "id = ?", sellerID).Error; err != nil || user.WalletAddress == nil || *user.WalletAddress == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Link a Solana wallet before staking"})
		return
	}
	providerWallet, err := solana.PublicKeyFromBase58String(*user.WalletAddress)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid linked Solana wallet"})
		return
	}

	oracle := solana.GetOracleClient()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Oracle unavailable"})
		return
	}

	// Check caller has enough SOL (preflight; authoritative debit happens under lock after chain success)
	var wallet models.Wallet
	if err := db.DB.First(&wallet, "user_id = ?", sellerID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Wallet not found"})
		return
	}
	if !wallet.CanAffordSOL(req.AmountSOL) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient SOL balance"})
		return
	}

	stakeLamports := solana.SOLToLamports(req.AmountSOL)
	if stakeLamports == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Staking amount too small"})
		return
	}

	// Find the provider node for this seller
	var node models.Node
	if err := db.DB.First(&node, "provider_user_id = ?", sellerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No registered node found for this provider"})
		return
	}

	// Execute canonical on-chain stake transaction first.
	ctxStake, cancelStake := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancelStake()

	txHash, stakePDA, err := oracle.StakeProvider(ctxStake, solana.StakeProviderParams{
		ProviderWallet: providerWallet,
		AmountLamports: stakeLamports,
	})
	if err != nil {
		if solana.IsProgramUpgradeRequired(err) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":       "Staking upgrade required: deployed Solana program does not support stake_provider yet. Deploy the latest proxyhub program version and retry.",
				"feature":     "staking_v2",
				"instruction": "stake_provider",
			})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "On-chain stake failed: " + err.Error()})
		return
	}

	// Read back authoritative on-chain stake balance for DB mirror.
	onChainLamports := stakeLamports
	if svc := solana.GetStakingService(); svc != nil {
		if synced, syncErr := svc.SyncStakeBalance(ctxStake, sellerID); syncErr == nil {
			onChainLamports = synced
		}
	}
	onChainSOL := solana.LamportsToSOL(onChainLamports)

	tx := db.DB.Begin()

	// Mirror the canonical on-chain stake in DB under row lock.
	lockedWallet, err := models.LockWalletForUpdate(tx, sellerID)
	if err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "On-chain stake succeeded but DB wallet lock failed; reconciliation required",
			"tx_hash": txHash,
		})
		return
	}
	if err := models.DebitWalletLockedOpts(tx, lockedWallet, req.AmountSOL, models.LedgerKindStake, txHash,
		"Node stake (DB mirror of on-chain stake_provider)",
		models.LedgerOpts{TxHash: txHash, JournalKind: "stake"},
	); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "On-chain stake succeeded but DB mirror debit failed; reconciliation required",
			"tx_hash": txHash,
			"detail":  err.Error(),
		})
		return
	}

	newStaked := onChainSOL
	// Boost node quality score to reflect stake (capped at 100)
	newScore := node.QualityScore + req.AmountSOL*2
	if newScore > 100 {
		newScore = 100
	}
	if err := tx.Model(&node).Updates(map[string]interface{}{
		"quality_score":     newScore,
		"staked_amount_sol": newStaked,
	}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "On-chain stake succeeded but DB node mirror update failed; reconciliation required",
			"tx_hash": txHash,
		})
		return
	}

	tx.Commit()

	// Compute rank from new quality score
	newRank := 99
	if newScore >= 95 {
		newRank = 1
	} else if newScore >= 80 {
		newRank = 10
	} else if newScore >= 60 {
		newRank = 50
	}

	c.JSON(http.StatusOK, gin.H{
		"tx_hash":             txHash,
		"stake_pda":           stakePDA.String(),
		"staked_sol_on_chain": onChainSOL,
		"new_rank":            newRank,
	})
}

// unstakeNode begins the unstaking cooldown period for a provider's node
func unstakeNode(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeChainAuthoritative, "write", "mirror")

	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	sellerID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req unstakeNodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify listing belongs to caller
	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ? AND seller_id = ?", req.ListingID, sellerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found or not owned by you"})
		return
	}

	var user models.User
	if err := db.DB.Select("wallet_address").First(&user, "id = ?", sellerID).Error; err != nil || user.WalletAddress == nil || *user.WalletAddress == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Link a Solana wallet before unstaking"})
		return
	}
	providerWallet, err := solana.PublicKeyFromBase58String(*user.WalletAddress)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid linked Solana wallet"})
		return
	}

	oracle := solana.GetOracleClient()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Oracle unavailable"})
		return
	}

	var node models.Node
	if err := db.DB.First(&node, "provider_user_id = ?", sellerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No registered node found for this provider"})
		return
	}

	// Load wallet so we can return the staked SOL (P0-04 fix — previously never returned).
	var wallet models.Wallet
	if err := db.DB.First(&wallet, "user_id = ?", sellerID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Wallet not found"})
		return
	}

	ctxUnstake, cancelUnstake := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancelUnstake()

	// Use chain as source of truth for current stake amount.
	var unstakeLamports uint64
	if svc := solana.GetStakingService(); svc != nil {
		if synced, syncErr := svc.SyncStakeBalance(ctxUnstake, sellerID); syncErr == nil {
			unstakeLamports = synced
		}
	}
	if unstakeLamports == 0 {
		unstakeLamports = solana.SOLToLamports(node.StakedAmountSOL)
	}
	if unstakeLamports == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No staked amount to unstake"})
		return
	}

	txHash, stakePDA, err := oracle.UnstakeProvider(ctxUnstake, solana.UnstakeProviderParams{
		ProviderWallet: providerWallet,
		AmountLamports: unstakeLamports,
	})
	if err != nil {
		if solana.IsProgramUpgradeRequired(err) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":       "Staking upgrade required: deployed Solana program does not support unstake_provider yet. Deploy the latest proxyhub program version and retry.",
				"feature":     "staking_v2",
				"instruction": "unstake_provider",
			})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "On-chain unstake failed: " + err.Error()})
		return
	}

	returnAmount := solana.LamportsToSOL(unstakeLamports)

	tx := db.DB.Begin()

	lockedWallet, err := models.LockWalletForUpdate(tx, sellerID)
	if err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "On-chain unstake succeeded but DB wallet lock failed; reconciliation required",
			"tx_hash": txHash,
		})
		return
	}
	if err := models.CreditWalletLockedOpts(tx, lockedWallet, returnAmount, models.LedgerKindUnstake, txHash,
		"Node unstake return (DB mirror of on-chain unstake_provider)",
		models.LedgerOpts{TxHash: txHash, JournalKind: "unstake"},
	); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "On-chain unstake succeeded but DB wallet mirror credit failed; reconciliation required",
			"tx_hash": txHash,
			"detail":  err.Error(),
		})
		return
	}

	// Reset quality score boost and clear staked amount
	resetScore := node.QualityScore * 0.8
	if err := tx.Model(&node).Updates(map[string]interface{}{
		"quality_score":     resetScore,
		"staked_amount_sol": 0.0,
	}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "On-chain unstake succeeded but DB node mirror update failed; reconciliation required",
			"tx_hash": txHash,
		})
		return
	}

	tx.Commit()

	c.JSON(http.StatusOK, gin.H{
		"message":      "Unstaking complete. Staked SOL has been returned to your wallet.",
		"tx_hash":      txHash,
		"stake_pda":    stakePDA.String(),
		"returned_sol": returnAmount,
		"new_balance":  lockedWallet.BalanceSOL,
	})
}

type stakePHBRequest struct {
	AmountPHB float64   `json:"amount_phb" binding:"required,gt=0"`
	ListingID uuid.UUID `json:"listing_id" binding:"required"`
}

// stakePHB records a PHB staking commitment for a provider node.
// The caller must hold ≥ amount_phb PHB on-chain (verified via GetTokenBalance).
// Tokens remain in the provider's wallet; locking them in a vault is Phase 5.
func stakePHB(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "read_only_balance_check", "source_of_truth")

	if rejectCentralizedStakingWhenFull(c) {
		return
	}

	mintStr := os.Getenv("PHB_TOKEN_MINT")
	if mintStr == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "PHB token not yet activated on this network"})
		return
	}

	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	providerID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req stakePHBRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Resolve on-chain wallet.
	var user models.User
	if err := db.DB.Select("wallet_address").First(&user, "id = ?", providerID).Error; err != nil || user.WalletAddress == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No linked Solana wallet found"})
		return
	}

	oracle := solana.GetOracleClient()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Oracle unavailable"})
		return
	}

	mintKey, err := solana.PublicKeyFromBase58String(mintStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid PHB mint"})
		return
	}
	walletPK, err := solana.PublicKeyFromBase58String(*user.WalletAddress)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wallet address"})
		return
	}

	ctx5, cancel5 := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel5()

	phbRaw, err := oracle.GetTokenBalance(ctx5, walletPK, mintKey)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to verify on-chain PHB balance"})
		return
	}
	onChainPHB := token.PHBFromRaw(phbRaw)
	if onChainPHB < req.AmountPHB {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("insufficient PHB: have %.4f, need %.4f", onChainPHB, req.AmountPHB),
		})
		return
	}

	// Verify listing belongs to caller.
	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ? AND seller_id = ?", req.ListingID, providerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found or not owned by you"})
		return
	}

	// Find provider node.
	var node models.Node
	if err := db.DB.First(&node, "provider_user_id = ?", providerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No registered node found for this provider"})
		return
	}

	// Check for existing active PHB stake — additive allowed.
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", providerID).First(&wallet).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Wallet record not found"})
		return
	}

	tx := db.DB.Begin()

	// Record staking position with PHB currency.
	pos := models.StakingPosition{
		UserID:    providerID,
		WalletID:  wallet.ID,
		Amount:    req.AmountPHB,
		Currency:  "PHB",
		APY:       12.0, // PHB staking yield — 12% APY baseline
		StartTime: time.Now(),
		Status:    models.StakingActive,
	}
	if err := tx.Create(&pos).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record PHB stake"})
		return
	}

	// Boost node quality score (1 PHB = 0.5 quality points, capped at 100).
	boost := req.AmountPHB * 0.5
	newScore := node.QualityScore + boost
	if newScore > 100 {
		newScore = 100
	}
	if err := tx.Model(&node).Update("quality_score", newScore).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update node quality"})
		return
	}

	tx.Commit()

	c.JSON(http.StatusOK, gin.H{
		"message":     "PHB stake recorded",
		"staked_phb":  req.AmountPHB,
		"position_id": pos.ID,
		"new_quality": newScore,
	})
}

// unstakePHB removes a PHB staking position and reduces the node's quality boost.
func unstakePHB(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")

	if rejectCentralizedStakingWhenFull(c) {
		return
	}

	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	providerID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	posIDStr := c.Query("position_id")
	posID, err := uuid.Parse(posIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "position_id query parameter required"})
		return
	}

	var pos models.StakingPosition
	if err := db.DB.First(&pos, "id = ? AND user_id = ? AND currency = 'PHB' AND status = 'active'", posID, providerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Active PHB staking position not found"})
		return
	}

	var node models.Node
	if err := db.DB.First(&node, "provider_user_id = ?", providerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No registered node found"})
		return
	}

	now := time.Now()
	tx := db.DB.Begin()

	if err := tx.Model(&pos).Updates(map[string]interface{}{
		"status":   models.StakingUnstaked,
		"end_time": now,
	}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unstake"})
		return
	}

	// Reduce quality score by the same boost amount.
	reduction := pos.Amount * 0.5
	newScore := node.QualityScore - reduction
	if newScore < 0 {
		newScore = 0
	}
	if err := tx.Model(&node).Update("quality_score", newScore).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update node quality"})
		return
	}

	tx.Commit()

	c.JSON(http.StatusOK, gin.H{
		"message":      "PHB unstaked successfully",
		"released_phb": pos.Amount,
		"new_quality":  newScore,
	})
}
