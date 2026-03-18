package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// RegisterDisputeRoutes wires dispute endpoints onto the protected group.
func RegisterDisputeRoutes(rg *gin.RouterGroup) {
	rg.POST("/disputes", createDispute)
	rg.GET("/disputes", listMyDisputes)
	rg.GET("/disputes/:id", getDispute)
	rg.POST("/admin/disputes/:id/resolve", resolveDispute)
	rg.POST("/admin/disputes/:id/dismiss", dismissDispute)
}

// POST /v1/disputes — consumer submits a dispute against a completed session
func createDispute(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req struct {
		SessionID   string `json:"session_id" binding:"required"`
		Reason      string `json:"reason" binding:"required"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sessionID, err := uuid.Parse(req.SessionID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid session_id"})
		return
	}

	// Verify session belongs to this consumer
	var session models.Session
	if err := db.DB.Where("id = ? AND user_id = ? AND deleted_at IS NULL", sessionID, userID).
		First(&session).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}

	if session.NodeID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session has no associated provider node"})
		return
	}

	// Get the provider node to identify the provider
	var node models.ProviderNode
	if err := db.DB.First(&node, "id = ?", session.NodeID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "provider node not found"})
		return
	}

	// Prevent duplicate disputes on the same session
	var existing models.Dispute
	if err := db.DB.Where("session_id = ? AND consumer_id = ? AND deleted_at IS NULL", sessionID, userID).
		First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "a dispute for this session already exists", "dispute_id": existing.ID})
		return
	}

	dispute := models.Dispute{
		SessionID:   sessionID,
		ConsumerID:  userID,
		ProviderID:  node.UserID,
		NodeID:      node.ID,
		Reason:      req.Reason,
		Description: req.Description,
		Status:      "open",
	}

	if err := db.DB.Create(&dispute).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create dispute"})
		return
	}

	// Increment dispute_count on the provider node
	db.DB.Model(&models.ProviderNode{}).
		Where("id = ?", node.ID).
		UpdateColumn("dispute_count", gorm.Expr("dispute_count + 1"))

	c.JSON(http.StatusCreated, dispute)
}

// GET /v1/disputes — list disputes for the calling user (consumer or provider view)
func listMyDisputes(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var disputes []models.Dispute
	db.DB.Where("(consumer_id = ? OR provider_id = ?) AND deleted_at IS NULL", userID, userID).
		Order("created_at DESC").
		Limit(50).
		Find(&disputes)

	c.JSON(http.StatusOK, gin.H{"disputes": disputes})
}

// GET /v1/disputes/:id
func getDispute(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	disputeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid dispute id"})
		return
	}

	var dispute models.Dispute
	if err := db.DB.Where("id = ? AND (consumer_id = ? OR provider_id = ?) AND deleted_at IS NULL",
		disputeID, userID, userID).First(&dispute).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "dispute not found"})
		return
	}

	c.JSON(http.StatusOK, dispute)
}

// POST /v1/admin/disputes/:id/resolve — admin resolves a dispute
func resolveDispute(c *gin.Context) {
	if !isAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	disputeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid dispute id"})
		return
	}

	var req struct {
		Resolution string  `json:"resolution" binding:"required"`
		RefundSOL  float64 `json:"refund_sol"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	now := time.Now()
	result := db.DB.Model(&models.Dispute{}).
		Where("id = ? AND status = 'open' AND deleted_at IS NULL", disputeID).
		Updates(map[string]interface{}{
			"status":      "resolved",
			"resolution":  req.Resolution,
			"refund_sol":  req.RefundSOL,
			"resolved_at": now,
		})

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "open dispute not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "dispute resolved", "resolved_at": now})
}

// POST /v1/admin/disputes/:id/dismiss — admin dismisses an invalid dispute
func dismissDispute(c *gin.Context) {
	if !isAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	disputeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid dispute id"})
		return
	}

	now := time.Now()
	result := db.DB.Model(&models.Dispute{}).
		Where("id = ? AND status = 'open' AND deleted_at IS NULL", disputeID).
		Updates(map[string]interface{}{
			"status":      "dismissed",
			"resolved_at": now,
		})

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "open dispute not found"})
		return
	}

	// When dismissed, decrement dispute_count on the node (false positive)
	var dispute models.Dispute
	db.DB.First(&dispute, "id = ?", disputeID)
	db.DB.Model(&models.ProviderNode{}).
		Where("id = ? AND dispute_count > 0", dispute.NodeID).
		UpdateColumn("dispute_count", gorm.Expr("dispute_count - 1"))

	c.JSON(http.StatusOK, gin.H{"message": "dispute dismissed", "resolved_at": now})
}

// isAdmin checks if the caller has admin privileges.
func isAdmin(c *gin.Context) bool {
	role, _ := c.Get("role")
	authType, _ := c.Get("auth_type")
	return role == "admin" || authType == "admin"
}
