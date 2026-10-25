package api

import (
	"context"
	"crypto/ed25519"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const providerClaimMinSOL = 0.01

// isProviderClaimEnabled reports whether the manual on-chain claim flow is switched on.
//
// BE-CRIT-02: confirmProviderClaim pays pending ProviderEarning rows straight from
// the treasury hot wallet without debiting the provider's wallet, on top of the
// billing worker and session-termination payouts for the same sessions. Until the
// payout path is unified it is off unless ENABLE_PROVIDER_CLAIM is true or 1.
func isProviderClaimEnabled() bool {
	flag := strings.TrimSpace(os.Getenv("ENABLE_PROVIDER_CLAIM"))
	return strings.EqualFold(flag, "true") || flag == "1"
}

func requireProviderClaimEnabled() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !isProviderClaimEnabled() {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": "provider claims are temporarily disabled",
				"code":  "provider_claim_disabled",
			})
			return
		}
		c.Next()
	}
}

// RegisterProviderClaimRoutes lets providers authorize and receive pending earnings on-chain.
func RegisterProviderClaimRoutes(rg *gin.RouterGroup) {
	rg.GET("/provider/claim/summary", getProviderClaimSummary)
	rg.POST("/provider/claim/prepare", requireProviderClaimEnabled(), prepareProviderClaim)
	rg.POST("/provider/claim/confirm", requireProviderClaimEnabled(), confirmProviderClaim)
}

func getProviderClaimSummary(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	pendingSOL, count, wallet := pendingProviderClaim(userID)
	c.JSON(http.StatusOK, gin.H{
		"pending_sol":    pendingSOL,
		"pending_count":  count,
		"payout_wallet":  wallet,
		"min_claim_sol":  providerClaimMinSOL,
		"oracle_ready":   solana.GetOracleClient() != nil,
	})
}

func prepareProviderClaim(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	pendingSOL, count, wallet := pendingProviderClaim(userID)
	if count == 0 || pendingSOL < providerClaimMinSOL {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":       "insufficient pending balance to claim",
			"pending_sol": pendingSOL,
			"min_claim_sol": providerClaimMinSOL,
		})
		return
	}
	if wallet == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "link a Solana payout wallet on your provider node first"})
		return
	}

	claimID := uuid.New()
	expires := time.Now().UTC().Add(15 * time.Minute)
	message := buildProviderClaimMessage(userID, claimID, wallet, pendingSOL, expires)

	c.JSON(http.StatusOK, gin.H{
		"claim_id":    claimID.String(),
		"message":     message,
		"amount_sol":  pendingSOL,
		"wallet":      wallet,
		"expires_at":  expires.Format(time.RFC3339),
		"instructions": "Sign this exact message with your payout wallet, then POST /v1/provider/claim/confirm",
	})
}

func confirmProviderClaim(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req struct {
		ClaimID   string `json:"claim_id" binding:"required"`
		Message   string `json:"message" binding:"required"`
		Signature string `json:"signature" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	claimUUID, err := uuid.Parse(req.ClaimID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid claim_id"})
		return
	}

	pendingSOL, _, wallet := pendingProviderClaim(userID)
	if pendingSOL < providerClaimMinSOL {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no pending balance to claim"})
		return
	}

	prefix := fmt.Sprintf("proxyhubb:provider-claim:%s:%s:%s:", userID.String(), claimUUID.String(), wallet)
	if !strings.HasPrefix(req.Message, prefix) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid claim message"})
		return
	}

	if !verifyProviderClaimSignature(wallet, req.Message, req.Signature) {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid signature for payout wallet"})
		return
	}

	oracle := solana.GetOracleClient()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "payout oracle not configured"})
		return
	}

	recipient, err := solanaGo.PublicKeyFromBase58(wallet)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payout wallet"})
		return
	}

	var paidSOL float64
	var earningIDs []uuid.UUID
	err = db.DB.Transaction(func(tx *gorm.DB) error {
		var locked []models.ProviderEarning
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("provider_user_id = ? AND status = ? AND deleted_at IS NULL", userID, "pending").
			Find(&locked).Error; err != nil {
			return err
		}
		if len(locked) == 0 {
			return fmt.Errorf("no pending earnings")
		}

		var total float64
		for _, e := range locked {
			total += e.NetAmountSOL
			earningIDs = append(earningIDs, e.ID)
		}
		if total < providerClaimMinSOL {
			return fmt.Errorf("pending below minimum")
		}
		paidSOL = total

		// Lock status to claiming state to prevent duplicate claims
		if err := tx.Model(&models.ProviderEarning{}).
			Where("id IN ?", earningIDs).
			Update("status", "claiming").Error; err != nil {
			return err
		}
		return nil
	})

	if err != nil {
		logging.Error(err).Str("claim_id", req.ClaimID).Msg("provider self-claim initialization failed")
		c.JSON(http.StatusBadRequest, gin.H{"error": "claim failed", "details": err.Error()})
		return
	}

	// Trigger on-chain transfer outside db transaction
	lamports := uint64(paidSOL * float64(solana.LamportsPerSOL))
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	txHash, sendErr := oracle.SendSOL(ctx, recipient, lamports)
	if sendErr != nil {
		// Revert status to pending on error
		revertErr := db.DB.Transaction(func(tx *gorm.DB) error {
			return tx.Model(&models.ProviderEarning{}).
				Where("id IN ?", earningIDs).
				Update("status", "pending").Error
		})
		if revertErr != nil {
			logging.Error(revertErr).Msg("CRITICAL: Failed to revert claiming status to pending after failed transfer")
		}
		logging.Error(sendErr).Str("claim_id", req.ClaimID).Msg("provider self-claim: blockchain transfer failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "claim failed", "details": "blockchain transfer failed: " + sendErr.Error()})
		return
	}

	// Finalize status to paid
	now := time.Now().UTC()
	finalizeErr := db.DB.Transaction(func(tx *gorm.DB) error {
		return tx.Model(&models.ProviderEarning{}).
			Where("id IN ?", earningIDs).
			Updates(map[string]interface{}{
				"status":  "paid",
				"tx_hash": txHash,
				"paid_at": now,
			}).Error
	})
	if finalizeErr != nil {
		logging.Error(finalizeErr).
			Str("tx_hash", txHash).
			Msg("CRITICAL: Failed to finalize claiming status to paid after successful transfer")
		// The blockchain transaction succeeded, so notify the user.
	}

	c.JSON(http.StatusOK, gin.H{
		"status":      "completed",
		"tx_hash":     txHash,
		"solscan_url": SolscanTxURL(txHash),
		"amount_sol":  paidSOL,
	})
}

func pendingProviderClaim(userID uuid.UUID) (total float64, count int64, wallet string) {
	ensureUserNodesPayoutWallets(userID)

	db.DB.Model(&models.ProviderEarning{}).
		Where("provider_user_id = ? AND status = ? AND deleted_at IS NULL", userID, "pending").
		Count(&count)
	db.DB.Model(&models.ProviderEarning{}).
		Where("provider_user_id = ? AND status = ? AND deleted_at IS NULL", userID, "pending").
		Select("COALESCE(SUM(net_amount_sol), 0)").
		Scan(&total)

	var node models.ProviderNode
	if err := db.DB.Where("user_id = ? AND deleted_at IS NULL AND wallet_address <> ''", userID).
		Order("updated_at DESC").
		First(&node).Error; err == nil {
		wallet = node.WalletAddress
	} else if err := db.DB.Where("user_id = ? AND deleted_at IS NULL", userID).
		Order("updated_at DESC").
		First(&node).Error; err == nil {
		wallet = node.WalletAddress
	}
	return total, count, wallet
}

func buildProviderClaimMessage(userID, claimID uuid.UUID, wallet string, amount float64, expires time.Time) string {
	return fmt.Sprintf("proxyhubb:provider-claim:%s:%s:%s:%.9f:%s",
		userID.String(), claimID.String(), wallet, amount, expires.UTC().Format(time.RFC3339))
}

func verifyProviderClaimSignature(wallet, message, signature string) bool {
	pubKeyBytes, err := base58.Decode(wallet)
	if err != nil || len(pubKeyBytes) != 32 {
		return false
	}
	sigBytes, err := base58.Decode(signature)
	if err != nil || len(sigBytes) != 64 {
		return false
	}
	return ed25519.Verify(pubKeyBytes, []byte(message), sigBytes)
}
