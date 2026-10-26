package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// getMyWithdrawals lists the caller's withdrawal payout queue rows,
// newest first (W-35: the client polls this to show queued/processing
// withdrawals reaching a terminal state instead of guessing from the
// balance). Only the caller's own rows are ever returned.
func getMyWithdrawals(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	limit := 20
	if raw := c.Query("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 50 {
			limit = n
		}
	}
	var rows []models.WithdrawalPayout
	if err := db.DB.Where("user_id = ?", userUUID).
		Order("created_at DESC").Limit(limit).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load withdrawals"})
		return
	}
	if rows == nil {
		rows = []models.WithdrawalPayout{}
	}
	c.JSON(http.StatusOK, gin.H{"withdrawals": rows})
}
