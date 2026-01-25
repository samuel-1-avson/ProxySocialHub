package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
)

func RegisterSystemRoutes(r *gin.RouterGroup) {
	r.GET("/system/config/public", getPublicSystemConfig)
	r.GET("/network/gateways", getFederatedGateways)
}

func getPublicSystemConfig(c *gin.Context) {
	var solanaTreasury models.SystemConfiguration

	// Fetch safely, ignore errors (defaults will be empty string)
	db.DB.Where("key = ?", "treasury_wallet_solana").First(&solanaTreasury)

	c.JSON(http.StatusOK, gin.H{
		"treasury_solana": solanaTreasury.Value,
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
