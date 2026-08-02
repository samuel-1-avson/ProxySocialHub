package middleware

import (
	"context"
	"net/http"
	"os"
	"strings"

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

func tierMint(tier SubscriptionTier) string {
	switch tier {
	case TierBronze:
		return strings.TrimSpace(os.Getenv("MINT_BRONZE_PASS"))
	case TierSilver:
		return strings.TrimSpace(os.Getenv("MINT_SILVER_PASS"))
	case TierGold:
		return strings.TrimSpace(os.Getenv("MINT_GOLD_PASS"))
	default:
		return ""
	}
}

// SubscriptionMiddleware gates routes based on NFT ownership.
//
// Access Passes are the entitlement source of truth via api.ResolvePassEntitlement
// (HasNFT + legacy grace). Prefer that resolver for quota gates. This middleware
// remains available for route-level NFT gates when a hard on-wallet check is desired.
func SubscriptionMiddleware(client *solana.OracleClient, requiredTier SubscriptionTier) gin.HandlerFunc {
	return func(c *gin.Context) {
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

		hasAccess := false

		if mintStr := tierMint(TierGold); mintStr != "" {
			goldMint, err := sol.PublicKeyFromBase58(mintStr)
			if err == nil {
				has, _ := client.HasNFT(context.Background(), wallet, goldMint)
				if has {
					hasAccess = true
				}
			}
		}

		if !hasAccess && requiredTier <= TierSilver {
			if mintStr := tierMint(TierSilver); mintStr != "" {
				silverMint, err := sol.PublicKeyFromBase58(mintStr)
				if err == nil {
					has, _ := client.HasNFT(context.Background(), wallet, silverMint)
					if has {
						hasAccess = true
					}
				}
			}
		}

		if !hasAccess && requiredTier <= TierBronze {
			if mintStr := tierMint(TierBronze); mintStr != "" {
				bronzeMint, err := sol.PublicKeyFromBase58(mintStr)
				if err == nil {
					has, _ := client.HasNFT(context.Background(), wallet, bronzeMint)
					if has {
						hasAccess = true
					}
				}
			}
		}

		// Free tier routes: no NFT required
		if !hasAccess && requiredTier == TierFree {
			hasAccess = true
		}

		if !hasAccess {
			c.AbortWithStatusJSON(http.StatusPaymentRequired, gin.H{
				"error":         "Access Pass required",
				"tier_required": requiredTier,
			})
			return
		}

		c.Next()
	}
}
