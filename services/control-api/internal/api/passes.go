package api

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
)

// RegisterPassPublicRoutes registers unauthenticated Access Pass catalog.
func RegisterPassPublicRoutes(rg *gin.RouterGroup) {
	rg.GET("/passes/catalog", getPassCatalog)
}

// RegisterPassRoutes registers Access Pass me + purchase endpoints.
func RegisterPassRoutes(rg *gin.RouterGroup) {
	rg.GET("/passes/me", getMyPass)
	rg.GET("/passes/migration", getPassMigrationStatus)
	rg.POST("/passes/prepare-purchase", preparePassPurchase)
	rg.POST("/passes/confirm-purchase", confirmPassPurchase)
}

type passCatalogItem struct {
	Tier             string   `json:"tier"`
	Name             string   `json:"name"`
	Mint             string   `json:"mint"`
	PriceSOL         float64  `json:"price_sol"`
	BandwidthLimitGB *int     `json:"bandwidth_limit_gb"`
	ListingLimit     int      `json:"listing_limit"`
	APIAccess        bool     `json:"api_access"`
	PrioritySupport  bool     `json:"priority_support"`
	PurchaseURL      string   `json:"purchase_url,omitempty"`
	Benefits         []string `json:"benefits"`
}

func catalogItemForTier(tier PassTier) passCatalogItem {
	caps := defaultPassCaps(tier)
	name := "Free"
	switch tier {
	case PassTierBronze:
		name = "Bronze"
	case PassTierSilver:
		name = "Silver"
	case PassTierGold:
		name = "Gold"
	}
	benefits := []string{}
	if caps.BandwidthGB == nil {
		benefits = append(benefits, "Unlimited GB / period")
	} else {
		benefits = append(benefits, fmt.Sprintf("%d GB / period", *caps.BandwidthGB))
	}
	if caps.Listings == 0 {
		benefits = append(benefits, "Unlimited listings")
	} else {
		benefits = append(benefits, fmt.Sprintf("%d listings", caps.Listings))
	}
	if caps.APIAccess {
		benefits = append(benefits, "API access")
	}
	if caps.Priority {
		benefits = append(benefits, "Priority support")
	}
	return passCatalogItem{
		Tier:             string(tier),
		Name:             name,
		Mint:             PassMintAddress(tier),
		PriceSOL:         passPriceSOL(tier),
		BandwidthLimitGB: caps.BandwidthGB,
		ListingLimit:     caps.Listings,
		APIAccess:        caps.APIAccess,
		PrioritySupport:  caps.Priority,
		PurchaseURL:      passPurchaseURL(tier),
		Benefits:         benefits,
	}
}

func getPassCatalog(c *gin.Context) {
	treasury := passTreasuryDestination()
	items := []passCatalogItem{
		catalogItemForTier(PassTierNone),
		catalogItemForTier(PassTierBronze),
		catalogItemForTier(PassTierSilver),
		catalogItemForTier(PassTierGold),
	}
	c.JSON(http.StatusOK, gin.H{
		"passes":            items,
		"treasury":          treasury,
		"purchase_mode":     "treasury_sol_transfer",
		"entitlement_model": "nft_access_pass",
		"notes":             "Paid tiers require holding the configured SPL mint in your linked wallet. Escrow remains the only bandwidth settlement rail.",
	})
}

func getMyPass(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	ent, err := ResolvePassEntitlement(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to resolve Access Pass"})
		return
	}

	remaining, unlimited, limitGB, _ := PlanBandwidthRemainingGB(userID)
	var legacyUntil *time.Time
	if ent.LegacySub != nil {
		legacyUntil = ent.LegacySub.CurrentPeriodEnd
	}

	c.JSON(http.StatusOK, gin.H{
		"tier":               ent.Tier,
		"source":             ent.Source,
		"name":               ent.Name,
		"wallet":             ent.Wallet,
		"holds":              ent.Holds,
		"bandwidth_limit_gb": ent.BandwidthLimitGB,
		"listing_limit":      ent.ListingLimit,
		"features":           ent.Features,
		"priority_support":   ent.PrioritySupport,
		"quota": gin.H{
			"remaining_gb": remaining,
			"unlimited":    unlimited,
			"limit_gb":     limitGB,
		},
		"legacy_access_until": legacyUntil,
		"mints": gin.H{
			"bronze": PassMintAddress(PassTierBronze),
			"silver": PassMintAddress(PassTierSilver),
			"gold":   PassMintAddress(PassTierGold),
		},
	})
}

type preparePassPurchaseRequest struct {
	Tier           string `json:"tier" binding:"required"`
	IdempotencyKey string `json:"idempotency_key"`
}

func preparePassPurchase(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	var req preparePassPurchaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	tier := PassTier(strings.ToLower(strings.TrimSpace(req.Tier)))
	if tier != PassTierBronze && tier != PassTierSilver && tier != PassTierGold {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tier must be bronze, silver, or gold"})
		return
	}
	wallet := profileWalletAddress(userID)
	if wallet == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Link a Solana wallet before purchasing an Access Pass"})
		return
	}
	treasury := passTreasuryDestination()
	if treasury == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Treasury destination not configured"})
		return
	}
	mint := PassMintAddress(tier)
	price := passPriceSOL(tier)
	if price <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Pass price not configured"})
		return
	}
	if url := passPurchaseURL(tier); url != "" {
		c.JSON(http.StatusOK, gin.H{
			"mode":         "external",
			"tier":         tier,
			"mint":         mint,
			"purchase_url": url,
			"price_sol":    price,
			"buyer_wallet": wallet,
		})
		return
	}

	lamports := models.SOLToLamports(price)
	purchaseID := uuid.New()
	idem := strings.TrimSpace(req.IdempotencyKey)
	if idem == "" {
		idem = purchaseID.String()
	}

	purchase := models.PassPurchase{
		ID:             purchaseID,
		UserID:         userID,
		Tier:           string(tier),
		Mint:           mint,
		BuyerWallet:    wallet,
		TreasuryWallet: treasury,
		AmountSOL:      price,
		Status:         models.PassPurchasePending,
		IdempotencyKey: idem,
	}
	if err := db.DB.Where("idempotency_key = ?", idem).FirstOrCreate(&purchase).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create purchase intent"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"mode":            "treasury_sol_transfer",
		"purchase_id":     purchase.ID,
		"tier":            tier,
		"mint":            mint,
		"buyer_wallet":    wallet,
		"treasury":        treasury,
		"amount_sol":      price,
		"amount_lamports": lamports,
		"memo":            "proxyhubb:pass:" + string(tier) + ":" + purchase.ID.String(),
		"instructions":    "Send exact amount_lamports of SOL from buyer_wallet to treasury, then POST /v1/passes/confirm-purchase with the signature.",
	})
}

type confirmPassPurchaseRequest struct {
	PurchaseID  string `json:"purchase_id"`
	Tier        string `json:"tier"`
	TxSignature string `json:"tx_signature" binding:"required"`
}

func confirmPassPurchase(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	var req confirmPassPurchaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sig := strings.TrimSpace(req.TxSignature)
	if sig == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tx_signature required"})
		return
	}

	var purchase models.PassPurchase
	if strings.TrimSpace(req.PurchaseID) != "" {
		pid, err := uuid.Parse(req.PurchaseID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid purchase_id"})
			return
		}
		if err := db.DB.Where("id = ? AND user_id = ?", pid, userID).First(&purchase).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Purchase intent not found"})
			return
		}
	} else {
		tier := PassTier(strings.ToLower(strings.TrimSpace(req.Tier)))
		if err := db.DB.Where("user_id = ? AND tier = ? AND status = ?", userID, tier, models.PassPurchasePending).
			Order("created_at DESC").First(&purchase).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "No pending purchase for tier"})
			return
		}
	}

	if purchase.Status == models.PassPurchaseConfirmed || purchase.Status == models.PassPurchaseFulfilled {
		c.JSON(http.StatusOK, gin.H{"purchase": purchase, "message": "Already confirmed"})
		return
	}

	oracle := solanaClient.GetOracleClient()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Oracle/RPC unavailable"})
		return
	}
	dest, err := sol.PublicKeyFromBase58(purchase.TreasuryWallet)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid treasury on purchase"})
		return
	}
	lamports, err := oracle.VerifyTransaction(c.Request.Context(), sig, dest)
	if err != nil {
		logging.Warn().Err(err).Str("sig", sig).Msg("pass purchase tx verify failed")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transaction verification failed: " + err.Error()})
		return
	}
	expected := models.SOLToLamports(purchase.AmountSOL)
	// Allow 1% under/over for rounding
	if lamports+expected/100 < expected {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":    "Insufficient payment amount",
			"received": lamports,
			"expected": expected,
		})
		return
	}

	now := time.Now().UTC()
	if err := db.DB.Model(&purchase).Updates(map[string]interface{}{
		"tx_signature": sig,
		"status":       models.PassPurchaseConfirmed,
		"updated_at":   now,
	}).Error; err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Failed to record purchase (possible duplicate signature)"})
		return
	}
	purchase.TxSignature = sig
	purchase.Status = models.PassPurchaseConfirmed

	actor := userID
	RecordAuditLog(c, models.AuditSettingsChanged, models.AuditSeverityInfo, &actor, "access_pass", purchase.ID.String(),
		"Confirmed Access Pass purchase "+purchase.Tier, true)

	c.JSON(http.StatusOK, gin.H{
		"purchase": purchase,
		"message":  "Payment confirmed. Entitlement is active via purchase receipt until your wallet holds the pass NFT.",
		"mint":     purchase.Mint,
		"next":     "Ensure the pass NFT is minted/transferred to your linked wallet; HasNFT will then take over entitlement.",
	})
}

func getPassMigrationStatus(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	ent, err := ResolvePassEntitlement(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to resolve entitlement"})
		return
	}

	eligibleTier := ""
	if ent.Source == "legacy_subscription" && ent.LegacySub != nil && ent.LegacySub.Plan != nil {
		eligibleTier = string(mapLegacyPlanToTier(ent.LegacySub.Plan))
		if eligibleTier == string(PassTierSilver) || eligibleTier == string(PassTierGold) {
			ensurePassAirdropEligible(userID, PassTier(eligibleTier), ent.Wallet, ent.LegacySub.Plan.Name)
		}
	}

	var claim models.PassAirdropClaim
	hasClaim := db.DB.Where("user_id = ?", userID).Order("created_at DESC").First(&claim).Error == nil

	var legacyUntil *time.Time
	if ent.LegacySub != nil {
		legacyUntil = ent.LegacySub.CurrentPeriodEnd
	}

	c.JSON(http.StatusOK, gin.H{
		"current_tier":          ent.Tier,
		"source":                ent.Source,
		"legacy_grace":          ent.Source == "legacy_subscription",
		"legacy_access_until":   legacyUntil,
		"airdrop_eligible_tier": eligibleTier,
		"airdrop_claim": func() interface{} {
			if hasClaim {
				return claim
			}
			return nil
		}(),
		"message": "Pro → Silver and Scale → Gold airdrops are fulfilled by ops after queuing. Grace continues until period end.",
	})
}

func ensurePassAirdropEligible(userID uuid.UUID, tier PassTier, wallet, planName string) {
	var existing models.PassAirdropClaim
	err := db.DB.Where("user_id = ? AND tier = ?", userID, string(tier)).First(&existing).Error
	if err == nil {
		return
	}
	_ = db.DB.Create(&models.PassAirdropClaim{
		ID:             uuid.New(),
		UserID:         userID,
		Tier:           string(tier),
		WalletAddress:  wallet,
		SourcePlanName: planName,
		Status:         models.PassAirdropEligible,
	}).Error
}
