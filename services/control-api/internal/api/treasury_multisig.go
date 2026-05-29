package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/gov"
	"github.com/proxyhubb/control-api/internal/treasury"
)

// RegisterTreasuryMultisigRoutes wires admin treasury multi-sig (2-of-3 for withdrawals >100 SOL).
func RegisterTreasuryMultisigRoutes(r *gin.RouterGroup) {
	g := r.Group("/treasury/withdrawals")
	g.Use(RequireRole("admin"))
	{
		g.GET("/pending", listPendingTreasuryWithdrawals)
		g.GET("/:id", getTreasuryWithdrawal)
		g.POST("/propose", proposeTreasuryWithdrawal)
		g.POST("/:id/sign", signTreasuryWithdrawal)
	}
}

func adminActorID(c *gin.Context) string {
	if id, ok := GetUserID(c); ok {
		return id.String()
	}
	return c.GetString("user_id")
}

func proposeTreasuryWithdrawal(c *gin.Context) {
	var req struct {
		Destination string  `json:"destination" binding:"required"`
		AmountSOL   float64 `json:"amount_sol" binding:"required,gt=0"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	adminID := adminActorID(c)
	governor := gov.GetGovernor()
	if !governor.IsAdmin(adminID) {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "admin not in TREASURY_MULTISIG_ADMIN_IDS",
		})
		return
	}

	if req.AmountSOL <= treasury.LargeTreasuryWithdrawalSOL {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":          "amount below multi-sig threshold",
			"threshold_sol":  treasury.LargeTreasuryWithdrawalSOL,
			"hint":           "use standard payout flows for smaller amounts",
		})
		return
	}

	id, err := governor.ProposeTreasuryWithdraw(req.Destination, req.AmountSOL, adminID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	action, _ := governor.GetAction(id)
	c.JSON(http.StatusCreated, gin.H{
		"action":    action,
		"threshold": 2,
		"message":   "Collect one more admin signature to execute",
	})
}

func signTreasuryWithdrawal(c *gin.Context) {
	actionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid action id"})
		return
	}

	adminID := adminActorID(c)
	governor := gov.GetGovernor()
	if !governor.IsAdmin(adminID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin not authorized to sign"})
		return
	}

	action, err := governor.SignAndMaybeExecute(c.Request.Context(), actionID, adminID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "action": action})
		return
	}

	c.JSON(http.StatusOK, gin.H{"action": action})
}

func listPendingTreasuryWithdrawals(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"actions": gov.GetGovernor().GetPendingActions(),
		"threshold_sol": treasury.LargeTreasuryWithdrawalSOL,
	})
}

func getTreasuryWithdrawal(c *gin.Context) {
	actionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid action id"})
		return
	}
	action, ok := gov.GetGovernor().GetAction(actionID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "action not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"action": action})
}
