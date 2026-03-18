package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
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
	rg.POST("/provider/nodes/:id/heartbeat", nodeHeartbeat)
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
	Name           string `json:"name" binding:"required"`
	IPAddress      string `json:"ip_address"`
	Country        string `json:"country"`
	City           string `json:"city"`
	ConnectionType string `json:"connection_type"` // residential|mobile|datacenter|fiber
}

// createNode creates a new provider node.
// IP ownership verification and duplicate IP detection are enforced.
func createNode(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var req CreateNodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Duplicate IP detection — same IP cannot be registered by the same provider twice
	if req.IPAddress != "" {
		var existing models.ProviderNode
		err := db.DB.Where("ip_address = ? AND user_id = ?", req.IPAddress, userID).
			First(&existing).Error
		if err == nil {
			c.JSON(http.StatusConflict, gin.H{
				"error":           "A node with this IP address is already registered to your account",
				"existing_node_id": existing.ID,
			})
			return
		}
	}

	node := models.ProviderNode{
		UserID:    userID,
		Name:      req.Name,
		IPAddress: req.IPAddress,
		Country:   req.Country,
		City:      req.City,
		Status:    models.NodeOffline,
	}

	// PostgreSQL inet column rejects empty string — omit the column so it defaults to NULL
	q := db.DB
	if req.IPAddress == "" {
		q = q.Omit("ip_address")
	}
	if err := q.Create(&node).Error; err != nil {
		logging.Error(err).Msg("createNode: DB error")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create node"})
		return
	}

	// Auto-publish a marketplace listing so the node is immediately discoverable.
	// The provider can update pricing/description later from their dashboard.
	go autoPublishListing(userID, node, req.ConnectionType)

	c.JSON(http.StatusCreated, node)
}

// autoPublishListing creates a default marketplace listing for a newly registered node.
func autoPublishListing(userID uuid.UUID, node models.ProviderNode, connType string) {
	svc := GetMarketplaceService()
	if svc == nil {
		return
	}

	// Map CLI connection type → marketplace proxy type
	proxyType := domain.Residential
	switch connType {
	case "mobile":
		proxyType = domain.Mobile
	case "datacenter":
		proxyType = domain.Datacenter
	case "fiber":
		proxyType = domain.Residential // fiber is residential-quality
	}

	title := node.Name + " Proxy"
	if node.City != "" || node.Country != "" {
		loc := node.City
		if node.Country != "" {
			if loc != "" {
				loc += ", "
			}
			loc += node.Country
		}
		title = node.Name + " — " + loc
	}

	listing := domain.ListingEntity{
		Title:                title,
		Description:          "High-quality " + string(proxyType) + " proxy node. Auto-listed on registration.",
		PricePerGB:           0.50, // default $0.50/GB — provider can adjust
		AvailableBandwidthGB: 100,  // default 100 GB — provider can adjust
		ProxyType:            proxyType,
		Protocol:             "http",
	}

	if _, err := svc.PublishListing(context.Background(), userID, listing); err != nil {
		logging.Error(err).Str("node_id", node.ID.String()).Msg("autoPublishListing: failed")
	} else {
		logging.Info().Str("node_id", node.ID.String()).Msg("autoPublishListing: listing created")
	}
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

	updates := map[string]interface{}{
		"name":    req.Name,
		"country": req.Country,
		"city":    req.City,
	}
	if req.IPAddress != "" {
		updates["ip_address"] = req.IPAddress
	} else {
		updates["ip_address"] = nil // explicitly NULL-out if cleared
	}
	db.DB.Model(&node).Updates(updates)

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

// nodeHeartbeat is called by the CLI daemon every 2 minutes to keep the node marked online.
// POST /v1/provider/nodes/:id/heartbeat
func nodeHeartbeat(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	// Optional metrics from CLI
	var req struct {
		LatencyMs         int     `json:"latency_ms"`
		ActiveConnections int     `json:"active_connections"`
		UptimePercent     float64 `json:"uptime_percent"`
	}
	_ = c.ShouldBindJSON(&req)

	now := time.Now()
	updates := map[string]interface{}{
		"last_seen_at": now,
		"status":       models.NodeOnline,
	}
	if req.LatencyMs > 0 {
		updates["avg_latency_ms"] = req.LatencyMs
	}
	if req.UptimePercent > 0 {
		updates["uptime_percent"] = req.UptimePercent
	}

	result := db.DB.Model(&models.ProviderNode{}).
		Where("id = ? AND user_id = ?", nodeID, userID).
		Updates(updates)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update heartbeat"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok", "server_time": now.Unix()})
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
