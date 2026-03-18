package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/treasury"
)

func RegisterSystemRoutes(r *gin.RouterGroup) {
	r.GET("/system/config/public", getPublicSystemConfig)
	r.GET("/network/gateways", getFederatedGateways)
	r.GET("/system/watchtower/status", getWatchtowerStatus)
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
		"treasury_solana": val,
		"sol_price_usd":   billing.GetSOLPriceUSD(),
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
