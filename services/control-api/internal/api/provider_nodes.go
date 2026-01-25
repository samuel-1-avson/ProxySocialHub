package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/bittensor"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/nats"
)

// RegisterProviderNodeRoutes registers provider node management routes
func RegisterProviderNodeRoutes(rg *gin.RouterGroup) {
	rg.GET("/provider/nodes", getMyNodes)
	rg.POST("/provider/nodes", createNode)
	rg.PUT("/provider/nodes/:id", updateNode)
	rg.DELETE("/provider/nodes/:id", deleteNode)
	rg.GET("/provider/nodes/:id/uptime", getNodeUptime)
}

// getMyNodes returns user's provider nodes
func getMyNodes(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var nodes []models.ProviderNode
	db.DB.Where("user_id = ?", userID).Order("created_at DESC").Find(&nodes)

	c.JSON(http.StatusOK, gin.H{"nodes": nodes})
}

type CreateNodeRequest struct {
	Name      string `json:"name" binding:"required"`
	IPAddress string `json:"ip_address"`
	Country   string `json:"country"`
	City      string `json:"city"`
}

// createNode creates a new provider node
func createNode(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var req CreateNodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	node := models.ProviderNode{
		UserID:    userID,
		Name:      req.Name,
		IPAddress: req.IPAddress,
		Country:   req.Country,
		City:      req.City,
		Status:    models.NodeOffline,
	}

	if err := db.DB.Create(&node).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create node"})
		return
	}

	// Phase 2: Decentralized Registry Integration
	// Attempt to register on-chain via Bridge
	go func(n models.ProviderNode) {
		client := GetBittensorClient()
		if client != nil {
			// Load config to get dynamic NetUID
			cfg, err := config.Load()
			netUID := 1 // Default fallback
			if err == nil {
				netUID = cfg.Bittensor.NetUID
			}

			logging.Info().Str("node_id", n.ID.String()).Int("net_uid", netUID).Msg("Attempting on-chain registration...")

			// Defaulting to NetUID from config and default wallet for now.
			// In production, the user would provide their wallet or we pay for them.
			resp, err := client.RegisterProxy(bittensor.RegisterProxyRequest{
				IP:           n.IPAddress,
				Port:         8080, // Assuming default port or we need to capture it from user
				NetUID:       netUID,
				WalletName:   "default",
				WalletHotkey: "default",
			})

			if err != nil {
				logging.Error(err).Str("node_id", n.ID.String()).Msg("Failed to register on-chain")
			} else if resp.Status == "success" {
				logging.Info().Str("node_id", n.ID.String()).Msg("Successfully registered on-chain")
				// Update DB
				db.DB.Model(&models.ProviderNode{}).Where("id = ?", n.ID).Updates(map[string]interface{}{
					"is_registered_on_chain": true,
					"net_uid":                netUID,
					"hotkey":                 "default",
				})
			} else {
				logging.Warn().Str("node_id", n.ID.String()).Msg("On-chain registration failed: " + resp.Message)
			}
		}
	}(node)

	c.JSON(http.StatusCreated, node)
}

// updateNode updates a provider node
func updateNode(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	var node models.ProviderNode
	if err := db.DB.Where("id = ? AND user_id = ?", nodeID, userID).First(&node).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}

	var req CreateNodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	db.DB.Model(&node).Updates(map[string]interface{}{
		"name":       req.Name,
		"ip_address": req.IPAddress,
		"country":    req.Country,
		"city":       req.City,
	})

	c.JSON(http.StatusOK, node)
}

// deleteNode deletes a provider node
func deleteNode(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	result := db.DB.Where("id = ? AND user_id = ?", nodeID, userID).Delete(&models.ProviderNode{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Node deleted"})
}

// getNodeUptime returns uptime statistics for a node
func getNodeUptime(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	// Verify ownership
	var node models.ProviderNode
	if err := db.DB.Where("id = ? AND user_id = ?", nodeID, userID).First(&node).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}

	// Get uptime stats (last 24 hours)
	since := time.Now().Add(-24 * time.Hour)
	var checks []models.UptimeCheck
	db.DB.Where("node_id = ? AND checked_at > ?", nodeID, since).Order("checked_at DESC").Find(&checks)

	var totalChecks, upChecks int
	var avgLatency float64
	for _, check := range checks {
		totalChecks++
		if check.IsUp {
			upChecks++
			avgLatency += float64(check.LatencyMs)
		}
	}

	uptimePercent := float64(0)
	if totalChecks > 0 {
		uptimePercent = (float64(upChecks) / float64(totalChecks)) * 100
		if upChecks > 0 {
			avgLatency = avgLatency / float64(upChecks)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"node_id":        nodeID,
		"uptime_percent": uptimePercent,
		"avg_latency_ms": avgLatency,
		"checks_24h":     totalChecks,
		"current_status": node.Status,
		"last_seen":      node.LastSeenAt,
	})
}

// UpdateNodeStatus updates a node's online status (called by gateway)
func UpdateNodeStatus(nodeID uuid.UUID, isOnline bool, latencyMs int) {
	// Replaced legacy DB updates with Hexagonal Service call
	err := GetMarketplaceService().UpdateNodeStatus(context.Background(), nodeID, isOnline, latencyMs)
	if err != nil {
		logging.Error(err).Str("node_id", nodeID.String()).Msg("Failed to update node status via core service")
	}

	// Phase 9.1 Real-time Telemetry: Publish Heartbeat to NATS
	heartbeat := domain.NodeHeartbeatEvent{
		NodeID:    nodeID.String(),
		IsHealthy: isOnline,
		LatencyMs: latencyMs,
		Timestamp: time.Now(),
	}
	nats.Publish(context.Background(), "proxy.telemetry.v1.heartbeat", heartbeat)
}
