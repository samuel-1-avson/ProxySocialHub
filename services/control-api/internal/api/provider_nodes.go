package api

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/geoip"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/nats"
	providerProofs "github.com/proxyhubb/control-api/internal/proofs"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
)

// RegisterProviderNodeRoutes registers provider node management routes
func RegisterProviderNodeRoutes(rg *gin.RouterGroup) {
	rg.GET("/provider/readiness", getProviderReadiness)
	rg.GET("/provider/nodes", getMyNodes)
	rg.POST("/provider/nodes", createNode)
	rg.PUT("/provider/nodes/:id", updateNode)
	rg.DELETE("/provider/nodes/:id", deleteNode)
	rg.GET("/provider/nodes/:id/uptime", getNodeUptime)
	rg.GET("/provider/nodes/:id/connect", getNodeConnectInfo)
	rg.POST("/provider/nodes/:id/heartbeat", nodeHeartbeat)
	rg.POST("/provider/listings/sign-offer", signListingOfferDev)
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

	req.IPAddress, req.Country, req.City = normalizeProviderNodeGeo(req.IPAddress, req.Country, req.City)

	// Duplicate IP detection — same IP cannot be registered by the same provider twice
	if req.IPAddress != "" {
		var existing models.ProviderNode
		err := db.DB.Where("ip_address = ? AND user_id = ?", req.IPAddress, userID).
			First(&existing).Error
		if err == nil {
			c.JSON(http.StatusConflict, gin.H{
				"error":            "A node with this IP address is already registered to your account",
				"existing_node_id": existing.ID,
			})
			return
		}
	}

	node := models.ProviderNode{
		ID:        uuid.New(),
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

	ensureNodePayoutWallet(node.ID, userID)
	_ = db.DB.Where("id = ?", node.ID).First(&node)

	gatewayID := providerGatewayNodeID(userID)
	_ = db.DB.Model(&node).Update("gateway_node_id", gatewayID).Error

	// Auto-publish a marketplace listing so the node is immediately discoverable.
	// The provider can update pricing/description later from their dashboard.
	go autoPublishListing(userID, node, req.ConnectionType)

	if node.Hotkey != "" {
		go registerProviderOnChainAsync(node.ID, node.Hotkey, req.IPAddress, req.Country)
	}

	// Update the nodes table with IP and geo data for explorer map visibility.
	if req.IPAddress != "" {
		var existingNode models.Node
		if err := db.DB.Where("provider_user_id = ? AND ip_address = ?", userID, "").
			Order("created_at DESC").
			First(&existingNode).Error; err == nil {
			updates := map[string]interface{}{
				"ip_address": req.IPAddress,
			}
			if req.Country != "" {
				updates["country_code"] = req.Country
			}
			if req.City != "" {
				updates["city"] = req.City
			}
			db.DB.Model(&existingNode).Updates(updates)
		}
	}
	scheduleNodeGeoEnrich(node.ID.String())
	reconcileProviderNodeRegistry(userID, node.ID, gatewayID, 0)

	c.JSON(http.StatusCreated, node)
}

const autoProviderListingDescriptionPrefix = "Auto-created provider listing draft"

// autoPublishListing creates a default hidden marketplace listing for a newly registered node.
func autoPublishListing(userID uuid.UUID, node models.ProviderNode, connType string) {
	if providerProofRequired() {
		logging.Info().
			Str("node_id", node.ID.String()).
			Msg("autoPublishListing: skipped (provider listing proof required in enforce mode)")
		return
	}

	// Map CLI connection type → marketplace proxy type
	proxyType := models.ProxyTypeResidential
	switch connType {
	case "mobile":
		proxyType = models.ProxyTypeMobile
	case "datacenter":
		proxyType = models.ProxyTypeDatacenter
	case "fiber":
		proxyType = models.ProxyTypeResidential // fiber is residential-quality
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

	nodeID := node.ID
	listing := models.ProxyListing{
		ID:                   uuid.New(),
		SellerID:             userID,
		ProviderNodeID:       &nodeID,
		Title:                title,
		Description:          autoProviderListingDescriptionPrefix + ". It becomes public after the node sends a healthy heartbeat.",
		PricePerGB:           0.50, // default SOL-denominated price per GB; provider can adjust
		MinPurchaseGB:        1,
		AvailableBandwidthGB: 100, // default 100 GB; provider can adjust
		ProxyType:            proxyType,
		Protocol:             "http",
		RotationType:         "static",
		Country:              node.Country,
		Status:               models.ListingStatusPaused,
		UptimePercent:        100,
		SuccessRate:          100,
		QualityScore:         100,
		CurrentTier:          "Bronze",
		AllowDirectMessage:   true,
	}

	if err := db.DB.Create(&listing).Error; err != nil {
		logging.Error(err).Str("node_id", node.ID.String()).Msg("autoPublishListing: failed")
	} else {
		invalidateMarketplaceReadModels()
		logging.Info().
			Str("node_id", node.ID.String()).
			Str("listing_id", listing.ID.String()).
			Msg("autoPublishListing: draft listing created")
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

	req.IPAddress, req.Country, req.City = normalizeProviderNodeGeo(req.IPAddress, req.Country, req.City)

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
	invalidateMarketplaceReadModels()
	scheduleNodeGeoEnrich(nodeID.String())

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

	invalidateMarketplaceReadModels()
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

	// Fetch bandwidth history
	var usage []struct {
		Timestamp time.Time `json:"timestamp"`
		Upload    int64     `json:"upload"`
		Download  int64     `json:"download"`
	}
	db.DB.Table("usage_records").
		Select("date_trunc('hour', created_at) as timestamp, SUM(bytes_up) as upload, SUM(bytes_down) as download").
		Where("node_id = ? AND created_at > ?", nodeID, since).
		Group("timestamp").
		Order("timestamp ASC").
		Scan(&usage)

	c.JSON(http.StatusOK, gin.H{
		"node_id":        nodeID,
		"uptime_percent": uptimePercent,
		"avg_latency_ms": avgLatency,
		"checks_24h":     totalChecks,
		"current_status": node.Status,
		"last_seen":      node.LastSeenAt,
		"history": gin.H{
			"uptime":    checks,
			"bandwidth": usage,
		},
	})
}

// getNodeConnectInfo returns public connection metadata for provider-node (no API keys).
// GET /v1/provider/nodes/:id/connect
func getNodeConnectInfo(c *gin.Context) {
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

	controlURL := strings.TrimRight(providerPublicControlAPIURL(), "/")
	tunnelAddr := providerPublicTunnelAddr()
	// Provider tunnel is TLS on production; keep true for https control API or public tunnel hosts.
	useTLS := true
	configHint := "~/.config/proxyhubb/provider.toml"
	startCmd := "provider-node start --config " + configHint

	c.JSON(http.StatusOK, gin.H{
		"node_id":             node.ID.String(),
		"control_api_url":     controlURL,
		"gateway_tunnel_addr": tunnelAddr,
		"use_tls":             useTLS,
		"connection_type":     "residential",
		"config_path_hint":    configHint,
		"start_command":       startCmd,
		// provider.toml must use this UUID as node_id (not nodes.id). See docs/NODE_REGISTRY.md.
		"registry_note": "Set provider.toml node_id to node_id above (provider_nodes UUID). Gateway identity is node_<profile_uuid> when linked.",
	})
}

func providerPublicControlAPIURL() string {
	if u := os.Getenv("PROVIDER_PUBLIC_CONTROL_API_URL"); u != "" {
		// Ignore stale example/testnet placeholders; fall through to real API URL.
		if !strings.Contains(u, "example.com") && !strings.Contains(u, "testnet.example") {
			return u
		}
	}
	if u := os.Getenv("API_BASE_URL"); u != "" {
		return u
	}
	if u := os.Getenv("PUBLIC_API_URL"); u != "" {
		return u
	}
	return "http://localhost:18080"
}

func providerPublicTunnelAddr() string {
	if a := os.Getenv("PROVIDER_TUNNEL_PUBLIC_ADDR"); a != "" {
		return strings.TrimPrefix(strings.TrimPrefix(a, "https://"), "http://")
	}
	return "localhost:3128"
}

// nodeHeartbeat is called by provider-node about every 120s (see provider.toml) to keep the node online.
// Rows go offline after PROVIDER_NODE_STALE_AFTER (default 5m) without a heartbeat.
// POST /v1/provider/nodes/:id/heartbeat
func nodeHeartbeat(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	// Fetch existing status to detect transition to online and verify optional provider proof.
	var currentNode models.ProviderNode
	if err := db.DB.Model(&models.ProviderNode{}).
		Where("id = ? AND user_id = ?", nodeID, userID).
		First(&currentNode).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}
	currentStatus := string(currentNode.Status)
	nodeName := currentNode.Name

	var req struct {
		LatencyMs         int                  `json:"latency_ms"`
		ActiveConnections int                  `json:"active_connections"`
		UptimePercent     float64              `json:"uptime_percent"`
		ProviderRunID     string               `json:"provider_run_id"`
		Proof             models.ProviderProof `json:"proof"`
	}
	_ = c.ShouldBindJSON(&req)

	gatewayNodeID := currentNode.GatewayNodeID
	if gatewayNodeID == "" {
		gatewayNodeID = req.Proof.GatewayNodeID
	}
	payloadHash := providerProofs.HashHeartbeatPayload(providerProofs.HeartbeatPayload{
		ProviderNodeID:    nodeID,
		GatewayNodeID:     gatewayNodeID,
		LatencyMs:         req.LatencyMs,
		ActiveConnections: req.ActiveConnections,
		UptimePercent:     req.UptimePercent,
		IssuedAt:          req.Proof.IssuedAt,
	})
	expectedHotkey := strings.TrimSpace(currentNode.Hotkey)
	proofResult := verifyProviderProof(req.Proof, providerProofs.ProviderHeartbeatMessageType, expectedHotkey, payloadHash)
	if proofResult.Present && !proofResult.Verified {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid provider heartbeat proof", "details": proofResult.VerificationError})
		return
	}
	if providerProofRequired() && !proofResult.Verified {
		c.JSON(http.StatusForbidden, gin.H{"error": "provider heartbeat proof required"})
		return
	}
	if proofResult.Verified {
		maybeBindProviderHotkey(nodeID, userID, proofResult.Signer, true)
		if expectedHotkey == "" && strings.TrimSpace(proofResult.Signer) != "" {
			currentNode.Hotkey = proofResult.Signer
		}
	}

	ensureNodePayoutWallet(nodeID, userID)

	now := time.Now()
	updates := map[string]interface{}{
		"last_seen_at":                        now,
		"status":                              models.NodeOnline,
		"latest_heartbeat_hash":               proofResult.Hash,
		"latest_heartbeat_signature":          proofResult.Signature,
		"latest_heartbeat_signer":             proofResult.Signer,
		"latest_heartbeat_signed_at":          proofResult.SignedAt,
		"latest_heartbeat_verified":           proofResult.Verified,
		"latest_heartbeat_verification_error": proofResult.VerificationError,
		"latest_heartbeat_nonce":              proofResult.Nonce,
	}
	if req.LatencyMs > 0 {
		updates["avg_latency_ms"] = req.LatencyMs
	}
	if req.UptimePercent > 0 {
		updates["uptime_percent"] = req.UptimePercent
	}
	if strings.TrimSpace(req.ProviderRunID) != "" {
		logging.Info().
			Str("node_id", nodeID.String()).
			Str("provider_run_id", strings.TrimSpace(req.ProviderRunID)).
			Msg("nodeHeartbeat: provider run observed")
	}

	result := db.DB.Model(&models.ProviderNode{}).
		Where("id = ? AND user_id = ?", nodeID, userID).
		Updates(updates)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update heartbeat"})
		return
	}
	reconcileProviderNodeRegistry(userID, nodeID, gatewayNodeID, req.LatencyMs)
	activateProviderListingDraftIfReady(userID, nodeID, proofResult.Verified || !providerProofRequired())
	invalidateMarketplaceReadModels()

	// D-C1: Mirror heartbeat metrics to the on-chain ProviderRegistry.
	// Fetch hotkey from DB (not in the current query); skip if unavailable.
	go func(nodeID uuid.UUID, latency int, uptime float64) {
		oracle := solanaClient.GetOracleClient()
		if oracle == nil {
			return
		}
		var hotkeyStr string
		if err := db.DB.Model(&models.ProviderNode{}).
			Where("id = ?", nodeID).
			Select("hotkey").
			Scan(&hotkeyStr).Error; err != nil || hotkeyStr == "" {
			return
		}
		providerPubkey, err := sol.PublicKeyFromBase58(hotkeyStr)
		if err != nil {
			return
		}
		qualityScore := uint8(100)
		if uptime > 0 {
			qualityScore = uint8(uptime)
			if qualityScore > 100 {
				qualityScore = 100
			}
		}
		sig, err := oracle.ProviderHeartbeatOnChain(context.Background(), solanaClient.ProviderHeartbeatParams{
			Provider:                providerPubkey,
			QualityScore:            qualityScore,
			BandwidthServedDelta:    0, // bandwidth delta tracked separately by session settlement
			SuccessfulSessionsDelta: 0,
			FailedSessionsDelta:     0,
		})
		if err != nil {
			logging.Warn().Err(err).Str("node_id", nodeID.String()).Msg("nodeHeartbeat: on-chain heartbeat failed (non-fatal)")
			return
		}
		logging.Info().Str("sig", sig).Str("node_id", nodeID.String()).Msg("nodeHeartbeat: on-chain heartbeat recorded")
	}(nodeID, req.LatencyMs, req.UptimePercent)

	// Re-resolve map coordinates when explorer still has no GPS (e.g. after LAN→WAN IP fix).
	go func(id string) {
		var explorer models.ExplorerNode
		if err := db.DB.Where("node_id = ?", id).First(&explorer).Error; err != nil {
			geoip.EnrichExplorerForProviderNode(id)
			return
		}
		if explorer.Latitude*explorer.Latitude+explorer.Longitude*explorer.Longitude < 0.0001 {
			geoip.EnrichExplorerForProviderNode(id)
		}
	}(nodeID.String())

	// Trigger Social Feed Event if node transitioned to Online
	if models.NodeStatus(currentStatus) != models.NodeOnline {
		PublishFeedEvent(*models.CreateFeedEvent(
			&userID,
			models.FeedEventNodeOnline,
			"node",
			&nodeID,
			"Provider Node "+nodeName+" is now online and actively routing traffic!",
			map[string]interface{}{
				"node_id":   nodeID.String(),
				"node_name": nodeName,
			},
		))
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok", "server_time": now.Unix()})
}

func activateProviderListingDraftIfReady(userID uuid.UUID, nodeID uuid.UUID, proofReady bool) {
	if !proofReady {
		return
	}
	result := db.DB.Model(&models.ProxyListing{}).
		Where("seller_id = ? AND provider_node_id = ? AND status = ? AND description LIKE ?",
			userID,
			nodeID,
			models.ListingStatusPaused,
			autoProviderListingDescriptionPrefix+"%",
		).
		Update("status", models.ListingStatusActive)
	if result.Error != nil {
		logging.Warn().
			Err(result.Error).
			Str("node_id", nodeID.String()).
			Msg("activateProviderListingDraftIfReady: failed")
		return
	}
	if result.RowsAffected > 0 {
		invalidateMarketplaceReadModels()
		logging.Info().
			Str("node_id", nodeID.String()).
			Int64("listings", result.RowsAffected).
			Msg("activateProviderListingDraftIfReady: provider listing published")
	}
}

// UpdateNodeStatus updates a node's online status (called by gateway)
func UpdateNodeStatus(nodeID uuid.UUID, isOnline bool, latencyMs int) {
	// Replaced legacy DB updates with Hexagonal Service call
	err := marketplaceServiceOrDefault().UpdateNodeStatus(context.Background(), nodeID, isOnline, latencyMs)
	if err != nil {
		logging.Error(err).Str("node_id", nodeID.String()).Msg("Failed to update node status via core service")
	}
	invalidateMarketplaceReadModels()

	// Phase 9.1 Real-time Telemetry: Publish Heartbeat to NATS
	heartbeat := domain.NodeHeartbeatEvent{
		NodeID:    nodeID.String(),
		IsHealthy: isOnline,
		LatencyMs: latencyMs,
		Timestamp: time.Now(),
	}
	nats.Publish(context.Background(), "proxy.telemetry.v1.heartbeat", heartbeat)
}
