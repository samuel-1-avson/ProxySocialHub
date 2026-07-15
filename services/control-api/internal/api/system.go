package api

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/geoip"
	"github.com/proxyhubb/control-api/internal/map/topology"
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
		// Fallback to empty if not found
		val = ""
	}

	c.JSON(http.StatusOK, gin.H{
		"treasury_solana":              val,
		"sol_price_usd":                billing.GetSOLPriceUSD(),
		"large_withdraw_threshold_sol": getLargeWithdrawalThresholdSOL(),
	})
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
