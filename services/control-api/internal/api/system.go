package api

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/gateways"
	"github.com/proxyhubb/control-api/internal/geoip"
	"github.com/proxyhubb/control-api/internal/incentives"
	"github.com/proxyhubb/control-api/internal/map/topology"
	"github.com/proxyhubb/control-api/internal/proofs"
	"github.com/proxyhubb/control-api/internal/settlement"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/treasury"
)

func RegisterSystemRoutes(r *gin.RouterGroup) {
	r.GET("/system/config/public", getPublicSystemConfig)
	r.GET("/system/provider-proof-policy", getListingProofPolicy)
	r.GET("/network/gateways", getFederatedGateways)
	r.GET("/system/watchtower/status", getWatchtowerStatus)
	r.GET("/system/map/health", getMapHealth)
	if env := os.Getenv("APP_ENV"); env == "" || env == "development" || env == "staging" {
		r.POST("/system/geoip/backfill", triggerGeoIPBackfill)
		r.POST("/system/map/links/aggregate", triggerMapLinksAggregate)
	}
}

func triggerGeoIPBackfill(c *gin.Context) {
	// Respond immediately so clients never see an empty reply during long ip-api batches.
	c.JSON(http.StatusAccepted, gin.H{
		"status":  "accepted",
		"message": "GeoIP backfill started in background (up to 45 nodes, ~1.4s each)",
	})
	go func() {
		n := geoip.BackfillAllProviderNodes()
		if n > 0 {
			log.Printf("[GeoIP] Provider enrich updated %d node(s)", n)
		}
		total := 0
		for i := 0; i < 10; i++ {
			batch := geoip.ResolveNextBatch()
			total += batch
			if batch == 0 {
				break
			}
		}
		if total > 0 {
			log.Printf("[GeoIP] Manual backfill updated %d explorer node(s)", total)
		}
		invalidateMarketplaceReadModels()
	}()
}

// triggerMapLinksAggregate runs one topology aggregation pass (dev/staging only).
func triggerMapLinksAggregate(c *gin.Context) {
	c.JSON(http.StatusAccepted, gin.H{
		"status":  "accepted",
		"message": "map link aggregation started",
	})
	go func() {
		count, err := topology.AggregateSessionLinks(time.Now())
		if err != nil {
			log.Printf("[MapTopology] manual aggregate failed: %v", err)
			return
		}
		NotifyLinkTopologyUpdate(count, count > 0)
		log.Printf("[MapTopology] manual aggregate upserted %d link(s)", count)
	}()
}

// RegisterSystemAdminRoutes registers admin-only system routes
func RegisterSystemAdminRoutes(r *gin.RouterGroup) {
	r.POST("/system/config", updateSystemConfig)
}

type UpdateConfigPayload struct {
	Key         string `json:"key" binding:"required"`
	Value       string `json:"value" binding:"required"`
	Description string `json:"description"`
}

func updateSystemConfig(c *gin.Context) {
	var payload UpdateConfigPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cm := GetConfigManager()
	if cm == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Config manager not initialized"})
		return
	}

	if err := cm.Set(payload.Key, payload.Value, payload.Description); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update config"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "updated", "key": payload.Key})
}

func getPublicSystemConfig(c *gin.Context) {
	cm := GetConfigManager()
	if cm == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Config manager not initialized"})
		return
	}

	val, err := cm.Get("treasury_wallet_solana")
	if err != nil {
		val = ""
	}
	val = strings.TrimSpace(val)
	// Prefer deposit destination helper (vault when PROXYHUB_DEPOSIT_VAULT_UI is on).
	if dest := strings.TrimSpace(solana.GetDepositDestinationAddress()); dest != "" {
		val = dest
	} else if val == "" {
		val = strings.TrimSpace(solana.GetTreasuryAddress())
	}

	kind := "treasury"
	if decentralization.DepositVaultUIEnabled() && solana.GetDepositVaultAddress() != "" &&
		val == solana.GetDepositVaultAddress() {
		kind = "vault"
	}

	c.JSON(http.StatusOK, gin.H{
		"treasury_solana":               val,
		"deposit_address":               val,
		"destination_kind":              kind,
		"vault_address":                 solana.GetDepositVaultAddress(),
		"legacy_treasury":               solana.GetTreasuryAddress(),
		"treasury_configured":           val != "",
		"sol_price_usd":                 billing.GetSOLPriceUSD(),
		"large_withdraw_threshold_sol":  getLargeWithdrawalThresholdSOL(),
		"discovery":                     discoveryHonestyMeta(),
		"provider_registry_gate":        decentralization.ProviderRegistryGateMode(),
		"zk_onchain_groth16":            decentralization.ZKOnchainGroth16Enabled(),
		"zk_onchain_groth16_ready":      decentralization.ZKOnchainGroth16Ready(),
		"zk_verification_mode":          zkVerificationMode(),
		"reputation":                    solana.ReputationStatusMeta(),
		"protocol_incentives":           incentives.StatusMeta(),
		"governance":                    decentralization.GovernanceAutonomyMeta(),
		"gateway_operator_bond_enforce": gateways.BondEnforceEnabled(),
		"gateway_operator_bond_mode":    gateways.BondEnforceMode(),
		"operator_manifest_mode":        gateways.ManifestMode(),
		"gateway_operators":             operatorDiscoveryPublicMeta(),
		"session_capability":            sessionCapabilityPublicMeta(),
		"settlement":                    settlementHonestyPublicMeta(),
	})
}

func operatorDiscoveryPublicMeta() gin.H {
	rows, err := gateways.ListActive(false)
	if err != nil {
		return gin.H{
			"operator_host_diversity": "unknown",
			"operator_org_diversity":  gateways.OrgDiversitySame,
			"control_plane":           "shared",
		}
	}
	return gin.H(gateways.HonestyMeta(rows))
}

func sessionCapabilityPublicMeta() gin.H {
	meta := decentralization.SessionCapabilityMeta()
	if pub := proofs.SessionCapabilityIssuerPubkey(); pub != "" {
		meta["session_capability_issuer_pubkey"] = pub
	}
	return gin.H(meta)
}

func settlementHonestyPublicMeta() gin.H {
	return gin.H{
		"settlement_sot":      settlement.ReceiptSoT(""),
		"settlement_execute":  settlement.ExecuteMode(),
		"would_broadcast":     settlement.WouldBroadcast(),
		"programs_session":    "unsafe_do_not_deploy",
		"note":                "Portable signed settlement receipts. Chain tx is SoT when present. Not trustless metering.",
	}
}

// getFederatedGateways returns a list of active, staked gateway nodes
func getFederatedGateways(c *gin.Context) {
	gateways, err := solana.GetFederatedGateways()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch gateway federation"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"gateways": gateways,
		"count":    len(gateways),
	})
}

func getWatchtowerStatus(c *gin.Context) {
	wt := treasury.NewWatchtower()
	paused, err := wt.IsPaused(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check system status"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"emergency_pause": paused})
}
