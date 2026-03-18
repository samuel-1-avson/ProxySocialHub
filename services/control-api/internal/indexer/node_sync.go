package indexer

import (
	"context"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/geoip"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// NodeSyncCallbacks holds optional hooks called after DB writes.
// Wire them from main.go via SetCallbacks to avoid circular imports.
type NodeSyncCallbacks struct {
	OnNodeUpdate func(*models.ExplorerNode)
}

// NodeSync periodically synchronizes active nodes to explorer tables
type NodeSync struct {
	isRunning    int32 // accessed atomically
	interval     time.Duration
	ctx          context.Context
	cancel       context.CancelFunc
	mu           sync.RWMutex
	db           *gorm.DB
	callbacks    NodeSyncCallbacks
}

// SetCallbacks sets notification callbacks called after each DB write.
func (ns *NodeSync) SetCallbacks(cb NodeSyncCallbacks) {
	ns.mu.Lock()
	ns.callbacks = cb
	ns.mu.Unlock()
}

// NodeSyncConfig holds configuration for node synchronization
type NodeSyncConfig struct {
	Interval     time.Duration
}

// NewNodeSync creates a new node sync instance
func NewNodeSync(cfg NodeSyncConfig) *NodeSync {
	if cfg.Interval == 0 {
		cfg.Interval = 5 * time.Minute
	}

	ctx, cancel := context.WithCancel(context.Background())

	return &NodeSync{
		interval: cfg.Interval,
		ctx:      ctx,
		cancel:   cancel,
		db:       db.DB,
	}
}

// Start begins the node synchronization loop
func (ns *NodeSync) Start() {
	if !atomic.CompareAndSwapInt32(&ns.isRunning, 0, 1) {
		return
	}

	logging.Info().Dur("interval", ns.interval).Msg("[NodeSync] Started")

	// Run immediately on start
	if err := ns.syncNodes(); err != nil {
		logging.Error(err).Msg("[NodeSync] Initial sync error")
	}

	go ns.loop()
}

// Stop stops the node sync
func (ns *NodeSync) Stop() {
	if !atomic.CompareAndSwapInt32(&ns.isRunning, 1, 0) {
		return
	}

	ns.cancel()

	logging.Info().Msg("[NodeSync] Stopped")
}

func (ns *NodeSync) loop() {
	ticker := time.NewTicker(ns.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ns.ctx.Done():
			return
		case <-ticker.C:
			if err := ns.syncNodes(); err != nil {
				logging.Error(err).Msg("[NodeSync] Sync error")
			}
		}
	}
}

// syncNodes synchronizes nodes from the main nodes table to explorer_nodes
func (ns *NodeSync) syncNodes() error {
	logging.Debug().Msg("[NodeSync] Starting node synchronization")

	// Get all active nodes from main nodes table
	var nodes []models.Node
	if err := ns.db.Where("is_healthy = ?", true).Find(&nodes).Error; err != nil {
		return err
	}

	// Get current session statistics
	sessionStats := ns.getSessionStats()

	// Sync each node
	for _, node := range nodes {
		if err := ns.syncNode(node, sessionStats[node.ID.String()]); err != nil {
			logging.Error(err).Str("node_id", node.ID.String()).Msg("[NodeSync] Failed to sync node")
		}
	}

	// Mark inactive nodes
	if err := ns.markInactiveNodes(nodes); err != nil {
		logging.Error(err).Msg("[NodeSync] Failed to mark inactive nodes")
	}

	logging.Info().
		Int("count", len(nodes)).
		Msg("[NodeSync] Node synchronization complete")

	return nil
}

// syncNode synchronizes a single node
func (ns *NodeSync) syncNode(node models.Node, stats SessionStats) error {
	// Get or create explorer node
	var explorerNode models.ExplorerNode

	err := ns.db.Where("node_id = ?", node.ID.String()).First(&explorerNode).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}

	// Calculate bandwidth from usage data
	bandwidth := ns.calculateNodeBandwidth(node.ID.String())

	// Calculate uptime
	uptime := ns.calculateNodeUptime(node)

	// Map region from node region
	region := node.Region
	if region == "" {
		region = "unknown"
	}

	// Determine if validator (based on provider tier or other criteria)
	isValidator := false
	if node.QualityScore > 90 {
		isValidator = true
	}

	// P0-13: resolve real coordinates from the node's IP address instead of
	// leaving them as the default (0, 0) forever.
	var (
		lat, lon    float64
		city, isp   string
		country     = ns.getCountryFromRegion(region)
	)
	if node.IPAddress != "" {
		if geo, ok := geoip.Resolve(node.IPAddress); ok {
			lat, lon = geo.Latitude, geo.Longitude
			city = geo.City
			isp = geo.ISP
			if geo.Country != "" {
				country = geo.Country
			}
			if geo.Region != "" && region == "unknown" {
				region = geo.Region
			}
		}
	}

	explorerNodeData := models.ExplorerNode{
		NodeID:         node.ID.String(),
		Chain:          "solana",
		Name:           ns.getNodeName(node),
		IP:             node.IPAddress,
		Region:         region,
		Country:        country,
		City:           city,
		ISP:            isp,
		Latitude:       lat,
		Longitude:      lon,
		IsActive:       node.IsHealthy,
		IsValidator:    isValidator,
		UptimePercent:  uptime,
		TotalBandwidth: bandwidth,
		ActiveSessions: stats.ActiveSessions,
		LastHeartbeat:  node.LastSeenAt,
		Version:        "", // Node model doesn't have Version field
	}

	if explorerNode.ID == uuid.Nil {
		// Create new
		explorerNodeData.ID = uuid.New()
		if err := ns.db.Create(&explorerNodeData).Error; err != nil {
			return err
		}
	} else {
		// Update existing
		if err := ns.db.Model(&explorerNode).Updates(explorerNodeData).Error; err != nil {
			return err
		}
	}

	// Broadcast the updated node to all connected WebSocket clients (if wired)
	ns.mu.RLock()
	cb := ns.callbacks.OnNodeUpdate
	ns.mu.RUnlock()
	if cb != nil {
		var updated models.ExplorerNode
		if err := ns.db.Where("node_id = ?", node.ID.String()).First(&updated).Error; err == nil {
			cb(&updated)
		}
	}

	return nil
}

// SessionStats holds statistics for a node
type SessionStats struct {
	ActiveSessions int
	TotalSessions  int
}

// getSessionStats gets session statistics for all nodes
func (ns *NodeSync) getSessionStats() map[string]SessionStats {
	stats := make(map[string]SessionStats)

	// Get active sessions count per node
	var results []struct {
		NodeID string
		Count  int64
	}

	ns.db.Model(&models.Session{}).
		Select("node_id, COUNT(*) as count").
		Where("status = ?", "active").
		Group("node_id").
		Scan(&results)

	for _, r := range results {
		stats[r.NodeID] = SessionStats{
			ActiveSessions: int(r.Count),
		}
	}

	return stats
}

// calculateNodeBandwidth calculates bandwidth for a node from the last 24 hours of session data.
// Using a 24h window prevents the metric from growing unbounded over the node's lifetime.
func (ns *NodeSync) calculateNodeBandwidth(nodeID string) uint64 {
	var totalBytes uint64
	since := time.Now().Add(-24 * time.Hour)

	ns.db.Model(&models.Session{}).
		Where("node_id = ? AND created_at >= ?", nodeID, since).
		Select("COALESCE(SUM(bytes_used), 0)").
		Scan(&totalBytes)

	return totalBytes
}

// calculateNodeUptime calculates uptime percentage from the last heartbeat time.
// Returns 100% if seen within 5 minutes, then decays linearly to 0% at 24 hours.
func (ns *NodeSync) calculateNodeUptime(node models.Node) float64 {
	if node.LastSeenAt.IsZero() {
		return 0.0
	}

	timeSinceLastSeen := time.Since(node.LastSeenAt)

	if timeSinceLastSeen < 5*time.Minute {
		return 100.0
	}

	hoursDown := timeSinceLastSeen.Hours()
	if hoursDown >= 24 {
		return 0.0
	}

	return math.Max(0, 100*(1-hoursDown/24))
}

// markInactiveNodes marks nodes as inactive if they're not in the active nodes list
func (ns *NodeSync) markInactiveNodes(activeNodes []models.Node) error {
	activeIDs := make([]string, len(activeNodes))
	for i, node := range activeNodes {
		activeIDs[i] = node.ID.String()
	}

	if len(activeIDs) == 0 {
		// No active nodes, mark all as inactive
		return ns.db.Model(&models.ExplorerNode{}).
			Where("is_active = ?", true).
			Update("is_active", false).Error
	}

	// Mark nodes not in active list as inactive
	return ns.db.Model(&models.ExplorerNode{}).
		Where("node_id NOT IN ?", activeIDs).
		Update("is_active", false).Error
}

// getNodeName gets a display name for the node
func (ns *NodeSync) getNodeName(node models.Node) string {
	// Try to get provider name
	var provider models.User
	if err := ns.db.Where("id = ?", node.ProviderUserID).First(&provider).Error; err == nil {
		if provider.Username != nil {
			return *provider.Username
		}
	}

	// Fallback to node info
	if node.IPAddress != "" {
		return node.IPAddress
	}

	return node.ID.String()[:8]
}

// getCountryFromRegion maps a region to a country (simplified)
func (ns *NodeSync) getCountryFromRegion(region string) string {
	regionMap := map[string]string{
		"us-east":      "United States",
		"us-west":      "United States",
		"eu-west":      "Ireland",
		"eu-central":   "Germany",
		"ap-south":     "India",
		"ap-southeast": "Singapore",
		"ap-northeast": "Japan",
		"sa-east":      "Brazil",
		"af-south":     "South Africa",
	}

	if country, ok := regionMap[region]; ok {
		return country
	}

	return region
}

// SyncNodeNow immediately syncs a specific node (for use by other services)
func (ns *NodeSync) SyncNodeNow(nodeID string) error {
	var node models.Node
	if err := ns.db.Where("id = ?", nodeID).First(&node).Error; err != nil {
		return err
	}

	stats := ns.getSessionStats()
	return ns.syncNode(node, stats[nodeID])
}

// GetNodeCount returns the total number of explorer nodes
func (ns *NodeSync) GetNodeCount() (total, active int64, err error) {
	err = ns.db.Model(&models.ExplorerNode{}).Count(&total).Error
	if err != nil {
		return 0, 0, err
	}

	err = ns.db.Model(&models.ExplorerNode{}).Where("is_active = ?", true).Count(&active).Error
	if err != nil {
		return total, 0, err
	}

	return total, active, nil
}
