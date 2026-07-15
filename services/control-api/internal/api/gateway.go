package api

import (
	"crypto/subtle"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/indexer"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// RegisterGatewayRoutes registers gateway-specific routes (called by Edge Gateway)
func RegisterGatewayRoutes(rg *gin.RouterGroup, cfg *config.Config) {
	gateway := rg.Group("/gateway")
	gateway.Use(requireGatewayAuth(cfg))
	{
		// Node registration and heartbeat
		gateway.POST("/nodes/register", registerGatewayNode)
		gateway.POST("/nodes/:id/heartbeat", updateGatewayNodeHeartbeat)
		gateway.POST("/nodes/:id/status", updateGatewayNodeStatus)
		gateway.POST("/session-intents/:id/state", updateGatewaySessionIntentState)
		gateway.POST("/session-intents/:id/usage", updateGatewaySessionIntentUsage)
	}
}

type GatewaySessionIntentStateRequest struct {
	LifecycleState string `json:"lifecycle_state" binding:"required"`
	ProviderNodeID string `json:"provider_node_id"`
	TargetHost     string `json:"target_host"`
}

type GatewaySessionIntentUsageRequest struct {
	ProviderNodeID string `json:"provider_node_id"`
	TargetHost     string `json:"target_host"`
	BytesUpDelta   int64  `json:"bytes_up_delta"`
	BytesDownDelta int64  `json:"bytes_down_delta"`
}

func updateGatewaySessionIntentState(c *gin.Context) {
	intentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session intent ID"})
		return
	}

	var req GatewaySessionIntentStateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var record models.SessionIntentRecord
	if err := db.DB.Where("id = ? AND deleted_at IS NULL", intentID).First(&record).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session intent not found"})
		return
	}
	if err := syncSessionIntentExpiration(&record); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refresh session intent state"})
		return
	}

	now := time.Now().UTC()
	updates := map[string]interface{}{
		"last_seen_at": now,
	}
	if providerNodeID := strings.TrimSpace(req.ProviderNodeID); providerNodeID != "" {
		updates["provider_node_id"] = providerNodeID
	}
	if targetHost := strings.TrimSpace(req.TargetHost); targetHost != "" {
		updates["target_host"] = targetHost
	}

	nextState := models.SessionIntentLifecycle(strings.TrimSpace(req.LifecycleState))
	if !isSupportedGatewaySessionIntentLifecycle(nextState) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported lifecycle_state"})
		return
	}
	if !canAdvanceGatewaySessionIntentLifecycle(record.LifecycleState, nextState) {
		c.JSON(http.StatusConflict, gin.H{"error": "Invalid lifecycle transition"})
		return
	}

	if nextState.IsPreActivation() && now.After(record.ExpiresAt) {
		nextState = models.SessionIntentExpired
	}
	if nextState == models.SessionIntentActive && record.ExpiresAt.Before(now) && record.LifecycleState.IsPreActivation() {
		nextState = models.SessionIntentExpired
	}
	applySessionIntentLifecycleTransition(&record, updates, nextState, now)

	if err := db.DB.Model(&record).Updates(updates).Error; err != nil {
		logging.Error(err).Str("intent_id", intentID.String()).Msg("Failed to update session intent state")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update session intent state"})
		return
	}

	if err := db.DB.Where("id = ?", intentID).First(&record).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reload session intent state"})
		return
	}

	c.JSON(http.StatusOK, buildSessionIntentStatusResponse(&record))
}

func updateGatewaySessionIntentUsage(c *gin.Context) {
	intentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session intent ID"})
		return
	}

	var req GatewaySessionIntentUsageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var record models.SessionIntentRecord
	if err := db.DB.Where("id = ? AND deleted_at IS NULL", intentID).First(&record).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session intent not found"})
		return
	}

	if err := syncSessionIntentExpiration(&record); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refresh session intent state"})
		return
	}

	now := time.Now().UTC()
	updates := map[string]interface{}{
		"last_seen_at":          now,
		"last_metered_at":       now,
		"last_bytes_up_delta":   req.BytesUpDelta,
		"last_bytes_down_delta": req.BytesDownDelta,
	}
	if providerNodeID := strings.TrimSpace(req.ProviderNodeID); providerNodeID != "" {
		updates["provider_node_id"] = providerNodeID
	}
	if targetHost := strings.TrimSpace(req.TargetHost); targetHost != "" {
		updates["target_host"] = targetHost
	}
	if req.BytesUpDelta != 0 {
		updates["total_bytes_up"] = gorm.Expr("COALESCE(total_bytes_up, 0) + ?", req.BytesUpDelta)
	}
	if req.BytesDownDelta != 0 {
		updates["total_bytes_down"] = gorm.Expr("COALESCE(total_bytes_down, 0) + ?", req.BytesDownDelta)
	}
	if req.BytesUpDelta != 0 || req.BytesDownDelta != 0 {
		updates["usage_update_count"] = gorm.Expr("COALESCE(usage_update_count, 0) + 1")
	}
	switch record.LifecycleState {
	case models.SessionIntentAuthorized, models.SessionIntentRouted:
		applySessionIntentLifecycleTransition(&record, updates, models.SessionIntentActive, now)
	case models.SessionIntentActive:
		if record.ActivatedAt == nil {
			updates["activated_at"] = now
		}
	}

	if err := db.DB.Model(&record).Updates(updates).Error; err != nil {
		logging.Error(err).Str("intent_id", intentID.String()).Msg("Failed to update session intent usage")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update session intent usage"})
		return
	}

	if err := db.DB.Where("id = ?", intentID).First(&record).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reload session intent usage"})
		return
	}

	c.JSON(http.StatusOK, buildSessionIntentStatusResponse(&record))
}

// requireGatewayAuth restricts gateway control-plane endpoints to trusted
// edge-gateway callers using a shared secret header.
func requireGatewayAuth(_ *config.Config) gin.HandlerFunc {
	sharedSecret := strings.TrimSpace(os.Getenv("GATEWAY_SHARED_SECRET"))

	return func(c *gin.Context) {
		if sharedSecret == "" {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "Gateway authentication is not configured"})
			return
		}

		provided := strings.TrimSpace(c.GetHeader("X-Gateway-Auth"))
		if subtle.ConstantTimeCompare([]byte(provided), []byte(sharedSecret)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized gateway request"})
			return
		}

		c.Next()
	}
}

// RegisterGatewayNodeRequest represents a node registration from the Edge Gateway
type RegisterGatewayNodeRequest struct {
	ProviderUserID string `json:"provider_user_id" binding:"required"`
	NodeID         string `json:"node_id" binding:"required"` // The node ID from Edge Gateway (e.g., "node_<user_id>")
	IPAddress      string `json:"ip_address" binding:"required"`
	Port           int    `json:"port"`
	Region         string `json:"region"`
	CountryCode    string `json:"country_code"`
	City           string `json:"city"`
	ISP            string `json:"isp"`
	ConnectionType string `json:"connection_type"` // residential, mobile, datacenter
	Version        string `json:"version"`
}

// registerGatewayNode creates or updates a node record when a provider connects via Edge Gateway
func registerGatewayNode(c *gin.Context) {
	var req RegisterGatewayNodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	req.IPAddress, req.CountryCode, req.City = normalizeGatewayGeo(req.IPAddress, req.CountryCode, req.City)

	// Parse provider user ID
	providerID, err := uuid.Parse(req.ProviderUserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider_user_id"})
		return
	}

	canonicalNode, canonicalCreated, err := upsertProviderNodeFromGateway(providerID, req)
	if err != nil {
		logging.Error(err).Str("gateway_node_id", req.NodeID).Msg("Failed to upsert canonical provider node")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upsert provider node"})
		return
	}

	// Check if node already exists — prefer GatewayNodeID (stable across IP changes),
	// fall back to provider+IP+port for legacy registrations without a NodeID.
	var existingNode models.Node
	if req.NodeID != "" {
		err = db.DB.Where("provider_user_id = ? AND gateway_node_id = ?", providerID, req.NodeID).First(&existingNode).Error
	}
	if err != nil && req.NodeID == "" {
		// Legacy path: match on provider + IP + port
		err = db.DB.Where("provider_user_id = ? AND ip_address = ? AND port = ?", providerID, req.IPAddress, req.Port).First(&existingNode).Error
	}

	if err != nil {
		node := models.Node{
			ID:                  uuid.New(),
			UserID:              providerID,
			ProviderUserID:      providerID,
			GatewayNodeID:       req.NodeID,
			IPAddress:           req.IPAddress,
			Port:                req.Port,
			Protocol:            "http",
			CountryCode:         req.CountryCode,
			Region:              req.Region,
			City:                req.City,
			ISP:                 req.ISP,
			ConnectionType:      req.ConnectionType,
			IsHealthy:           true,
			ActiveConnections:   0,
			MaxConnections:      100,
			QualityScore:        100,
			UptimePercent:       100,
			LastSeenAt:          time.Now(),
			IsRegisteredOnChain: false,
			ProviderNodeID:      &canonicalNode.ID,
		}

		if err := db.DB.Create(&node).Error; err != nil {
			logging.Error(err).Str("node_id", req.NodeID).Msg("Failed to create gateway node")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create node"})
			return
		}

		scheduleNodeGeoEnrich(canonicalNode.ID.String())

		reconcileProviderNodeRegistry(providerID, canonicalNode.ID, req.NodeID, 0)

		logging.Info().
			Str("node_id", canonicalNode.ID.String()).
			Str("gateway_row_id", node.ID.String()).
			Str("provider_id", providerID.String()).
			Str("gateway_node_id", req.NodeID).
			Msg("Gateway node registered")

		c.JSON(http.StatusCreated, gin.H{
			"id":                canonicalNode.ID.String(),
			"node_id":           req.NodeID,
			"status":            "created",
			"is_healthy":        true,
			"quality_score":     canonicalNode.QualityScore,
			"current_tier":      canonicalNode.Tier,
			"base_price_per_gb": canonicalNode.BasePricePerGB,
		})
	} else {
		// Update existing node
		updates := map[string]interface{}{
			"is_healthy":      true,
			"last_seen_at":    time.Now(),
			"region":          req.Region,
			"country_code":    req.CountryCode,
			"city":            req.City,
			"isp":             req.ISP,
			"connection_type": req.ConnectionType,
		}
		if req.Port > 0 {
			updates["port"] = req.Port
		}
		if req.NodeID != "" {
			updates["gateway_node_id"] = req.NodeID
		}
		updates["provider_node_id"] = canonicalNode.ID

		if err := db.DB.Model(&existingNode).Updates(updates).Error; err != nil {
			logging.Error(err).Str("node_id", existingNode.ID.String()).Msg("Failed to update gateway node")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update node"})
			return
		}

		scheduleNodeGeoEnrich(canonicalNode.ID.String())

		reconcileProviderNodeRegistry(providerID, canonicalNode.ID, req.NodeID, 0)

		logging.Info().
			Str("node_id", canonicalNode.ID.String()).
			Str("gateway_row_id", existingNode.ID.String()).
			Str("gateway_node_id", req.NodeID).
			Msg("Gateway node reconnected")

		status := "updated"
		if canonicalCreated {
			status = "created"
		}
		c.JSON(http.StatusOK, gin.H{
			"id":                canonicalNode.ID.String(),
			"node_id":           req.NodeID,
			"status":            status,
			"is_healthy":        true,
			"quality_score":     canonicalNode.QualityScore,
			"current_tier":      canonicalNode.Tier,
			"base_price_per_gb": canonicalNode.BasePricePerGB,
		})
	}
}

func upsertProviderNodeFromGateway(providerID uuid.UUID, req RegisterGatewayNodeRequest) (*models.ProviderNode, bool, error) {
	now := time.Now().UTC()
	node := resolveProviderNodeForGateway(providerID, req.NodeID)
	created := false
	if node == nil {
		name := req.NodeID
		if name == "" {
			name = "Gateway Node"
		}
		node = &models.ProviderNode{
			ID:            uuid.New(),
			UserID:        providerID,
			Name:          name,
			GatewayNodeID: req.NodeID,
			CreatedAt:     now,
		}
		created = true
	}

	updates := map[string]interface{}{
		"gateway_node_id":    req.NodeID,
		"ip_address":         req.IPAddress,
		"country":            req.CountryCode,
		"city":               req.City,
		"region":             req.Region,
		"isp":                req.ISP,
		"connection_type":    req.ConnectionType,
		"protocol":           "http",
		"status":             models.NodeOnline,
		"is_healthy":         true,
		"active_connections": 0,
		"max_connections":    100,
		"quality_score":      100,
		"uptime_percent":     100,
		"last_seen_at":       now,
		"updated_at":         now,
	}
	if req.Port > 0 {
		updates["port"] = req.Port
	}

	if created {
		node.IPAddress = req.IPAddress
		node.Country = req.CountryCode
		node.City = req.City
		node.Region = req.Region
		node.ISP = req.ISP
		node.ConnectionType = req.ConnectionType
		node.Protocol = "http"
		node.Status = models.NodeOnline
		node.IsHealthy = true
		node.ActiveConnections = 0
		node.MaxConnections = 100
		node.QualityScore = 100
		node.UptimePercent = 100
		node.LastSeenAt = &now
		node.UpdatedAt = now
		if req.Port > 0 {
			node.Port = req.Port
		}
		if err := db.DB.Create(node).Error; err != nil {
			return nil, false, err
		}
		return node, true, nil
	}

	if err := db.DB.Model(node).Updates(updates).Error; err != nil {
		return nil, false, err
	}
	if err := db.DB.Where("id = ?", node.ID).First(node).Error; err != nil {
		return nil, false, err
	}
	return node, false, nil
}

// GatewayHeartbeatRequest represents a heartbeat update from Edge Gateway
type GatewayHeartbeatRequest struct {
	ActiveConnections int   `json:"active_connections"`
	TotalBytesUp      int64 `json:"total_bytes_up"`
	TotalBytesDown    int64 `json:"total_bytes_down"`
	LatencyMs         int   `json:"latency_ms"`
	IsHealthy         bool  `json:"is_healthy"`
}

// updateGatewayNodeHeartbeat updates node stats from Edge Gateway heartbeat
func updateGatewayNodeHeartbeat(c *gin.Context) {
	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	var req GatewayHeartbeatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{
		"last_seen_at":       time.Now(),
		"is_healthy":         req.IsHealthy,
		"active_connections": req.ActiveConnections,
		"latency_ms":         req.LatencyMs,
	}

	if req.TotalBytesUp > 0 {
		updates["total_bytes_up"] = req.TotalBytesUp
	}
	if req.TotalBytesDown > 0 {
		updates["total_bytes_down"] = req.TotalBytesDown
	}

	providerUpdate := db.DB.Model(&models.ProviderNode{}).Where("id = ?", nodeID).Updates(updates)
	if providerUpdate.Error != nil {
		logging.Error(providerUpdate.Error).Str("node_id", nodeID.String()).Msg("Failed to update node heartbeat")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update heartbeat"})
		return
	}
	updatedProviderNode := providerUpdate.RowsAffected > 0
	qualityScore := 0.0
	currentTier := ""
	basePricePerGB := 0.0
	explorerSyncID := nodeID.String()

	if !updatedProviderNode {
		if err := db.DB.Model(&models.Node{}).Where("id = ?", nodeID).Updates(updates).Error; err != nil {
			logging.Error(err).Str("node_id", nodeID.String()).Msg("Failed to update legacy node heartbeat")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update heartbeat"})
			return
		}
	}

	// Recalculate quality score using latest stats
	var node models.ProviderNode
	if updatedProviderNode {
		if err := db.DB.Where("id = ?", nodeID).First(&node).Error; err == nil {
			newScore := node.CalculateQualityScore()
			if err := db.DB.Model(&node).Update("quality_score", newScore).Error; err != nil {
				logging.Warn().Str("node_id", nodeID.String()).Err(err).Msg("Failed to update quality score on heartbeat")
			}
			reconcileProviderNodeRegistry(node.UserID, node.ID, node.GatewayNodeID, req.LatencyMs)
			qualityScore = newScore
			currentTier = node.Tier
			basePricePerGB = node.BasePricePerGB
		}
	} else {
		var legacyNode models.Node
		if err := db.DB.Where("id = ?", nodeID).First(&legacyNode).Error; err == nil {
			newScore := legacyNode.CalculateQualityScore()
			if err := db.DB.Model(&legacyNode).Update("quality_score", newScore).Error; err != nil {
				logging.Warn().Str("node_id", nodeID.String()).Err(err).Msg("Failed to update quality score on legacy heartbeat")
			}
			if legacyNode.ProviderUserID != uuid.Nil && legacyNode.GatewayNodeID != "" {
				if pn := resolveProviderNodeForGateway(legacyNode.ProviderUserID, legacyNode.GatewayNodeID); pn != nil {
					reconcileProviderNodeRegistry(legacyNode.ProviderUserID, pn.ID, legacyNode.GatewayNodeID, req.LatencyMs)
					node = *pn
					explorerSyncID = pn.ID.String()
					qualityScore = node.QualityScore
					currentTier = node.Tier
					basePricePerGB = node.BasePricePerGB
				} else {
					syncProviderNodeFromGateway(legacyNode.ProviderUserID, legacyNode.GatewayNodeID, req.LatencyMs)
				}
			}
			if qualityScore == 0 {
				qualityScore = newScore
				currentTier = legacyNode.CurrentTier
				basePricePerGB = legacyNode.BasePricePerGB
			}
			if explorerSyncID == nodeID.String() {
				if legacyNode.ProviderNodeID != nil && *legacyNode.ProviderNodeID != uuid.Nil {
					explorerSyncID = legacyNode.ProviderNodeID.String()
				} else if pn := resolveProviderNodeForGateway(legacyNode.ProviderUserID, legacyNode.GatewayNodeID); pn != nil {
					explorerSyncID = pn.ID.String()
				}
			}
		}
	}

	// Trigger immediate sync to update explorer with latest heartbeat data
	go func(syncID string) {
		if ns := indexer.GetNodeSync(); ns != nil {
			if err := ns.SyncNodeNow(syncID); err != nil {
				logging.Debug().Err(err).Str("node_id", syncID).Msg("Heartbeat node sync skipped")
			}
		}
	}(explorerSyncID)

	c.JSON(http.StatusOK, gin.H{
		"status":            "ok",
		"timestamp":         time.Now(),
		"quality_score":     qualityScore,
		"current_tier":      currentTier,
		"base_price_per_gb": basePricePerGB,
	})
}

// GatewayStatusUpdateRequest represents a status update from Edge Gateway
type GatewayStatusUpdateRequest struct {
	IsHealthy bool   `json:"is_healthy"`
	Status    string `json:"status"` // "online", "offline", "degraded"
	Reason    string `json:"reason,omitempty"`
}

// updateGatewayNodeStatus updates node online/offline status
func updateGatewayNodeStatus(c *gin.Context) {
	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	var req GatewayStatusUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{
		"is_healthy":   req.IsHealthy,
		"last_seen_at": time.Now(),
	}

	result := db.DB.Model(&models.ProviderNode{}).Where("id = ?", nodeID).Updates(updates)
	if result.Error != nil {
		logging.Error(result.Error).Str("node_id", nodeID.String()).Msg("Failed to update node status")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update status"})
		return
	}
	if result.RowsAffected == 0 {
		if err := db.DB.Model(&models.Node{}).Where("id = ?", nodeID).Updates(updates).Error; err != nil {
			logging.Error(err).Str("node_id", nodeID.String()).Msg("Failed to update legacy node status")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update status"})
			return
		}
	}

	// Trigger immediate sync to update explorer with status change
	go func(nodeID string) {
		if ns := indexer.GetNodeSync(); ns != nil {
			if err := ns.SyncNodeNow(nodeID); err != nil {
				logging.Debug().Err(err).Str("node_id", nodeID).Msg("Status update node sync skipped")
			}
		}
	}(nodeID.String())

	logging.Info().
		Str("node_id", nodeID.String()).
		Bool("is_healthy", req.IsHealthy).
		Str("status", req.Status).
		Msg("Gateway node status updated")

	c.JSON(http.StatusOK, gin.H{
		"status":     "ok",
		"is_healthy": req.IsHealthy,
		"timestamp":  time.Now(),
	})
}

// GetNodeByProviderAndIP looks up a node by provider ID and IP+port (used by gateway)
func GetNodeByProviderAndIP(providerID uuid.UUID, ipAddress string, port int) (*models.Node, error) {
	var node models.Node
	err := db.DB.Where("provider_user_id = ? AND ip_address = ? AND port = ?", providerID, ipAddress, port).First(&node).Error
	if err != nil {
		return nil, err
	}
	return &node, nil
}
