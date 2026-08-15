package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/settlement"
)

func exportSettlementReceipt(c *gin.Context) {
	secret := settlement.SigningKey()
	if secret == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "settlement bundle signing key not configured",
			"honesty": gin.H{
				"settlement_sot":  settlement.ReceiptSoT(""),
				"would_broadcast": settlement.WouldBroadcast(),
			},
		})
		return
	}
	windowKey := strings.TrimSpace(c.Param("window_key"))
	if windowKey == "" {
		windowKey = strings.TrimSpace(c.Query("window_key"))
	}
	if windowKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "window_key required"})
		return
	}
	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database unavailable"})
		return
	}
	var m models.SettlementManifest
	if err := db.DB.Where("window_key = ?", windowKey).First(&m).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "settlement window not found"})
		return
	}
	escrowTx := strings.TrimSpace(c.Query("escrow_tx"))
	r := settlement.FromManifest(&m, escrowTx)
	if err := settlement.SignReceipt(&r, secret); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, r)
}
