package middleware

import (
	"context"
	"net/http"
	"os"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/solana"
)

// SubscriptionTier represents access level
type SubscriptionTier int

const (
	TierFree SubscriptionTier = iota
	TierBronze
	TierSilver
	TierGold
)

// TierMints holds the NFT mint addresses for each tier
var TierMints = map[SubscriptionTier]string{
	TierBronze: os.Getenv("MINT_BRONZE_PASS"), // e.g. "Bronz..."
	TierSilver: os.Getenv("MINT_SILVER_PASS"),
	TierGold:   os.Getenv("MINT_GOLD_PASS"),
}

// SubscriptionMiddleware gates routes based on NFT ownership
func SubscriptionMiddleware(client *solana.OracleClient, requiredTier SubscriptionTier) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Get user's wallet address from context (set by auth middleware)
		// Assuming "wallet_address" is set
		walletStr := c.GetString("wallet_address")
		if walletStr == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Wallet not found in context"})
			return
		}

		wallet, err := sol.PublicKeyFromBase58(walletStr)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid wallet address"})
			return
		}

		// Iterate checks from required tier upwards
		hasAccess := false

		// Check Gold (access to everything)
		if TierMints[TierGold] != "" {
			goldMint, _ := sol.PublicKeyFromBase58(TierMints[TierGold])
			has, _ := client.HasNFT(context.Background(), wallet, goldMint)
			if has {
				hasAccess = true
			}
		}

		// Check Silver (if required <= Silver and not yet found)
		if !hasAccess && requiredTier <= TierSilver && TierMints[TierSilver] != "" {
			silverMint, _ := sol.PublicKeyFromBase58(TierMints[TierSilver])
			has, _ := client.HasNFT(context.Background(), wallet, silverMint)
			if has {
				hasAccess = true
			}
		}

		// Check Bronze (if required <= Bronze and not yet found)
		if !hasAccess && requiredTier <= TierBronze && TierMints[TierBronze] != "" {
			bronzeMint, _ := sol.PublicKeyFromBase58(TierMints[TierBronze])
			has, _ := client.HasNFT(context.Background(), wallet, bronzeMint)
			if has {
				hasAccess = true
			}
		}

		if !hasAccess {
			c.AbortWithStatusJSON(http.StatusPaymentRequired, gin.H{
				"error":         "Subscription pass required",
				"tier_required": requiredTier,
			})
			return
		}

		c.Next()
	}
}
