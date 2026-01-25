package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

func RegisterSystemRoutes(r *gin.RouterGroup) {
	r.GET("/system/config/public", getPublicSystemConfig)
}

func getPublicSystemConfig(c *gin.Context) {
	var solanaTreasury models.SystemConfiguration

	// Fetch safely, ignore errors (defaults will be empty string)
	db.DB.Where("key = ?", "treasury_wallet_solana").First(&solanaTreasury)

	c.JSON(http.StatusOK, gin.H{
		"treasury_solana": solanaTreasury.Value,
	})
}
