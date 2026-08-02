package api

import (
	"context"
	"os"
	"strconv"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/treasury"
	"gorm.io/gorm"
)

// PassTier is the wallet-native access level (NFT Access Pass).
type PassTier string

const (
	PassTierNone   PassTier = "none"
	PassTierBronze PassTier = "bronze"
	PassTierSilver PassTier = "silver"
	PassTierGold   PassTier = "gold"
)

// PassEntitlement is the resolved buyer quota / feature set.
type PassEntitlement struct {
	Tier             PassTier
	Source           string // nft | legacy_subscription | purchase_receipt | free
	Name             string
	BandwidthLimitGB *int // nil = unlimited
	ListingLimit     int
	Features         models.Features
	PrioritySupport  bool
	PeriodStart      time.Time
	LegacySub        *models.UserSubscription
	Wallet           string
	Holds            map[string]bool
}

type passTierCaps struct {
	BandwidthGB *int // nil unlimited
	Listings    int
	TeamMembers int
	APIAccess   bool
	Analytics   bool
	Priority    bool
}

func protocolParamOrEnv(name, envKey, fallback string) string {
	if db.DB != nil {
		var param models.ProtocolParameter
		if err := db.DB.First(&param, "name = ?", name).Error; err == nil {
			if v := strings.TrimSpace(param.Value); v != "" {
				return v
			}
		}
	}
	if envKey != "" {
		if v := strings.TrimSpace(os.Getenv(envKey)); v != "" {
			return v
		}
	}
	return fallback
}

func protocolParamIntOrEnv(name, envKey string, fallback int) int {
	raw := protocolParamOrEnv(name, envKey, "")
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return fallback
	}
	return n
}

// PassMintAddress returns the configured mint for a paid tier (governance overrides env).
func PassMintAddress(tier PassTier) string {
	switch tier {
	case PassTierBronze:
		return protocolParamOrEnv("pass_mint_bronze", "MINT_BRONZE_PASS", "")
	case PassTierSilver:
		return protocolParamOrEnv("pass_mint_silver", "MINT_SILVER_PASS", "")
	case PassTierGold:
		return protocolParamOrEnv("pass_mint_gold", "MINT_GOLD_PASS", "")
	default:
		return ""
	}
}

func passPriceSOL(tier PassTier) float64 {
	var name, env string
	var fallback float64
	switch tier {
	case PassTierBronze:
		name, env, fallback = "pass_price_bronze_sol", "PASS_BRONZE_PRICE_SOL", 0.5
	case PassTierSilver:
		name, env, fallback = "pass_price_silver_sol", "PASS_SILVER_PRICE_SOL", 2.0
	case PassTierGold:
		name, env, fallback = "pass_price_gold_sol", "PASS_GOLD_PRICE_SOL", 5.0
	default:
		return 0
	}
	raw := protocolParamOrEnv(name, env, "")
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || v < 0 {
		return fallback
	}
	return v
}

func passPurchaseURL(tier PassTier) string {
	switch tier {
	case PassTierBronze:
		return protocolParamOrEnv("pass_purchase_url_bronze", "PASS_BRONZE_PURCHASE_URL", "")
	case PassTierSilver:
		return protocolParamOrEnv("pass_purchase_url_silver", "PASS_SILVER_PURCHASE_URL", "")
	case PassTierGold:
		return protocolParamOrEnv("pass_purchase_url_gold", "PASS_GOLD_PURCHASE_URL", "")
	default:
		return ""
	}
}

func defaultPassCaps(tier PassTier) passTierCaps {
	switch tier {
	case PassTierBronze:
		gb := protocolParamIntOrEnv("pass_bandwidth_bronze_gb", "PASS_BRONZE_BANDWIDTH_GB", 50)
		return passTierCaps{
			BandwidthGB: &gb,
			Listings:    protocolParamIntOrEnv("pass_listings_bronze", "PASS_BRONZE_LISTINGS", 10),
			TeamMembers: 1,
			APIAccess:   true,
			Analytics:   true,
		}
	case PassTierSilver:
		gb := protocolParamIntOrEnv("pass_bandwidth_silver_gb", "PASS_SILVER_BANDWIDTH_GB", 200)
		return passTierCaps{
			BandwidthGB: &gb,
			Listings:    protocolParamIntOrEnv("pass_listings_silver", "PASS_SILVER_LISTINGS", 25),
			TeamMembers: 5,
			APIAccess:   true,
			Analytics:   true,
		}
	case PassTierGold:
		listings := protocolParamIntOrEnv("pass_listings_gold", "PASS_GOLD_LISTINGS", 0) // 0 = unlimited
		return passTierCaps{
			BandwidthGB: nil,
			Listings:    listings,
			TeamMembers: -1,
			APIAccess:   true,
			Analytics:   true,
			Priority:    true,
		}
	default:
		gb := protocolParamIntOrEnv("pass_bandwidth_free_gb", "PASS_FREE_BANDWIDTH_GB", 10)
		return passTierCaps{
			BandwidthGB: &gb,
			Listings:    protocolParamIntOrEnv("pass_listings_free", "PASS_FREE_LISTINGS", 2),
			TeamMembers: 0,
			APIAccess:   false,
			Analytics:   false,
		}
	}
}

func entitlementFromCaps(tier PassTier, source string) PassEntitlement {
	caps := defaultPassCaps(tier)
	name := string(tier)
	if tier == PassTierNone {
		name = "free"
	}
	return PassEntitlement{
		Tier:             tier,
		Source:           source,
		Name:             name,
		BandwidthLimitGB: caps.BandwidthGB,
		ListingLimit:     caps.Listings,
		PrioritySupport:  caps.Priority,
		Features: models.Features{
			APIAccess:   caps.APIAccess,
			Analytics:   caps.Analytics,
			TeamMembers: caps.TeamMembers,
		},
		PeriodStart: time.Now().UTC().AddDate(0, -1, 0),
		Holds:       map[string]bool{},
	}
}

// ResolvePassTier checks on-chain NFT ownership for Bronze/Silver/Gold (higher wins).
func ResolvePassTier(ctx context.Context, walletStr string) (PassTier, map[string]bool, error) {
	holds := map[string]bool{
		"bronze": false,
		"silver": false,
		"gold":   false,
	}
	walletStr = strings.TrimSpace(walletStr)
	if walletStr == "" {
		return PassTierNone, holds, nil
	}
	wallet, err := sol.PublicKeyFromBase58(walletStr)
	if err != nil {
		return PassTierNone, holds, nil
	}
	oracle := solanaClient.GetOracleClient()
	if oracle == nil {
		return PassTierNone, holds, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	check := func(tier PassTier, key string) {
		mintStr := PassMintAddress(tier)
		if mintStr == "" {
			return
		}
		mint, err := sol.PublicKeyFromBase58(mintStr)
		if err != nil {
			return
		}
		has, err := oracle.HasNFT(ctx, wallet, mint)
		if err != nil {
			logging.Warn().Err(err).Str("tier", string(tier)).Msg("HasNFT check failed")
			return
		}
		holds[key] = has
	}

	check(PassTierGold, "gold")
	check(PassTierSilver, "silver")
	check(PassTierBronze, "bronze")

	switch {
	case holds["gold"]:
		return PassTierGold, holds, nil
	case holds["silver"]:
		return PassTierSilver, holds, nil
	case holds["bronze"]:
		return PassTierBronze, holds, nil
	default:
		return PassTierNone, holds, nil
	}
}

func mapLegacyPlanToTier(plan *models.SubscriptionPlan) PassTier {
	if plan == nil {
		return PassTierNone
	}
	name := strings.ToLower(strings.TrimSpace(plan.Name))
	switch {
	case strings.Contains(name, "scale"), strings.Contains(name, "gold"), strings.Contains(name, "enterprise"):
		return PassTierGold
	case strings.Contains(name, "pro"), strings.Contains(name, "silver"):
		return PassTierSilver
	case strings.Contains(name, "bronze"):
		return PassTierBronze
	case strings.EqualFold(name, "free") || (plan.PriceMonthly <= 0 && plan.PriceYearly <= 0):
		return PassTierNone
	default:
		// Unknown paid plan → treat as Silver (Pro-equivalent grace).
		if plan.PriceMonthly > 0 || plan.PriceYearly > 0 {
			return PassTierSilver
		}
		return PassTierNone
	}
}

func loadLegacyGraceSubscription(userID uuid.UUID) (*models.UserSubscription, error) {
	now := time.Now().UTC()
	var sub models.UserSubscription
	err := db.DB.Preload("Plan").
		Where("user_id = ?", userID).
		Where(`(
			status = ? OR
			(status = ? AND current_period_end IS NOT NULL AND current_period_end > ?)
		)`, models.SubscriptionActive, models.SubscriptionCancelled, now).
		Order("current_period_end DESC NULLS LAST").
		First(&sub).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if sub.Status == models.SubscriptionActive &&
		sub.CurrentPeriodEnd != nil &&
		sub.CurrentPeriodEnd.Before(now) &&
		sub.CancelledAt == nil {
		_ = db.DB.Model(&sub).Update("status", models.SubscriptionExpired)
		return nil, nil
	}
	if sub.Plan == nil {
		return nil, nil
	}
	tier := mapLegacyPlanToTier(sub.Plan)
	if tier == PassTierNone {
		return nil, nil
	}
	return &sub, nil
}

func loadRecentPassPurchase(userID uuid.UUID) (*models.PassPurchase, PassTier) {
	if db.DB == nil {
		return nil, PassTierNone
	}
	cutoff := time.Now().UTC().Add(-7 * 24 * time.Hour)
	var purchase models.PassPurchase
	err := db.DB.Where("user_id = ? AND status = ? AND created_at >= ?", userID, models.PassPurchaseConfirmed, cutoff).
		Order("created_at DESC").
		First(&purchase).Error
	if err != nil {
		return nil, PassTierNone
	}
	return &purchase, PassTier(purchase.Tier)
}

// ResolvePassEntitlement returns NFT-first entitlement with legacy Pro/Scale grace.
func ResolvePassEntitlement(userID uuid.UUID) (*PassEntitlement, error) {
	wallet := profileWalletAddress(userID)
	tier, holds, err := ResolvePassTier(context.Background(), wallet)
	if err != nil {
		return nil, err
	}

	if tier != PassTierNone {
		ent := entitlementFromCaps(tier, "nft")
		ent.Wallet = wallet
		ent.Holds = holds
		return &ent, nil
	}

	// Temporary bridge after primary-sale payment until NFT ATA is detected.
	if purchase, pTier := loadRecentPassPurchase(userID); purchase != nil && pTier != PassTierNone {
		ent := entitlementFromCaps(pTier, "purchase_receipt")
		ent.Wallet = wallet
		ent.Holds = holds
		ent.PeriodStart = purchase.CreatedAt
		return &ent, nil
	}

	legacy, err := loadLegacyGraceSubscription(userID)
	if err != nil {
		return nil, err
	}
	if legacy != nil && legacy.Plan != nil {
		mapped := mapLegacyPlanToTier(legacy.Plan)
		if mapped != PassTierNone {
			ent := entitlementFromCaps(mapped, "legacy_subscription")
			ent.Wallet = wallet
			ent.Holds = holds
			ent.LegacySub = legacy
			ent.PeriodStart = legacy.CurrentPeriodStart
			// Prefer DB plan caps when present so grace matches purchased quota.
			if legacy.Plan.BandwidthLimitGB != nil {
				ent.BandwidthLimitGB = legacy.Plan.BandwidthLimitGB
			} else if strings.EqualFold(legacy.Plan.Name, "scale") || mapped == PassTierGold {
				ent.BandwidthLimitGB = nil
			}
			if legacy.Plan.ListingLimit > 0 || mapped == PassTierGold {
				ent.ListingLimit = legacy.Plan.ListingLimit
			}
			ent.Features = legacy.Plan.Features
			ent.PrioritySupport = legacy.Plan.PrioritySupport
			ent.Name = legacy.Plan.Name
			return &ent, nil
		}
	}

	ent := entitlementFromCaps(PassTierNone, "free")
	ent.Wallet = wallet
	ent.Holds = holds
	return &ent, nil
}

// passEntitlementAsPlan synthesizes a SubscriptionPlan for legacy call sites / API shapes.
func passEntitlementAsPlan(ent *PassEntitlement) *models.SubscriptionPlan {
	if ent == nil {
		fallback := entitlementFromCaps(PassTierNone, "free")
		ent = &fallback
	}
	return &models.SubscriptionPlan{
		Name:             ent.Name,
		ListingLimit:     ent.ListingLimit,
		BandwidthLimitGB: ent.BandwidthLimitGB,
		Features:         ent.Features,
		PrioritySupport:  ent.PrioritySupport,
		IsActive:         true,
	}
}

func passTreasuryDestination() string {
	if hot := treasury.GetHotTreasuryPubkey(); !hot.IsZero() {
		return hot.String()
	}
	return strings.TrimSpace(os.Getenv("SOLANA_TREASURY_ADDRESS"))
}
