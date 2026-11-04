package indexer

import (
	"context"
	"math"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/geo"
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

// globalNodeSync holds the singleton instance for access by other packages
var globalNodeSync *NodeSync

// GetNodeSync returns the global NodeSync instance (may be nil if not started)
func GetNodeSync() *NodeSync {
	return globalNodeSync
}

// NodeSync periodically synchronizes active nodes to explorer tables
type NodeSync struct {
	isRunning int32 // accessed atomically
	interval  time.Duration
	ctx       context.Context
	cancel    context.CancelFunc
	mu        sync.RWMutex
	db        *gorm.DB
	callbacks NodeSyncCallbacks
}

// SetCallbacks sets notification callbacks called after each DB write.
func (ns *NodeSync) SetCallbacks(cb NodeSyncCallbacks) {
	ns.mu.Lock()
	ns.callbacks = cb
	ns.mu.Unlock()
}

// NodeSyncConfig holds configuration for node synchronization
type NodeSyncConfig struct {
	Interval time.Duration
}

// NewNodeSync creates a new node sync instance
func NewNodeSync(cfg NodeSyncConfig) *NodeSync {
	if cfg.Interval == 0 {
		cfg.Interval = 5 * time.Minute
	}

	ctx, cancel := context.WithCancel(context.Background())

	ns := &NodeSync{
		interval: cfg.Interval,
		ctx:      ctx,
		cancel:   cancel,
		db:       db.DB,
	}

	// Store as global instance for access by other packages
	globalNodeSync = ns
	return ns
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

// TriggerSync manually triggers an immediate sync (non-blocking)
func (ns *NodeSync) TriggerSync() {
	go func() {
		if err := ns.syncNodes(); err != nil {
			logging.Error(err).Msg("[NodeSync] Manual sync error")
		}
	}()
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

// syncNodes synchronizes canonical provider_nodes to explorer_nodes.
func (ns *NodeSync) syncNodes() error {
	logging.Debug().Msg("[NodeSync] Starting node synchronization")

	var nodes []models.ProviderNode
	if err := ns.db.Where("is_healthy = ? OR status = ?", true, models.NodeOnline).Find(&nodes).Error; err != nil {
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
func (ns *NodeSync) syncNode(node models.ProviderNode, stats SessionStats) error {
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

	// P0-13: resolve coordinates from a public provider IP when available.
	// Never rewrite the stored IP to the control-api WAN / cloud egress.
	effectiveIP := geoip.PublicIPForGeo(node.IPAddress)
	if effectiveIP == "" || geoip.IsControlPlanePublicIP(effectiveIP) || geoip.IsUntrustedGatewayGeo(effectiveIP, node.ISP) {
		if alt := ns.residentialIPForProvider(node.ID.String()); alt != "" {
			effectiveIP = alt
		} else {
			effectiveIP = ""
		}
	}
	// Scrub a poisoned control-plane/cloud IP off provider_nodes so it cannot
	// keep re-geolocating the explorer pin on every sync tick.
	if geoip.IsControlPlanePublicIP(node.IPAddress) || geoip.IsUntrustedGatewayGeo(node.IPAddress, node.ISP) {
		_ = ns.db.Model(&node).Updates(map[string]interface{}{
			"ip_address": nil,
			"isp":        nil,
		}).Error
		node.IPAddress = ""
		node.ISP = ""
	}
	country, cityHint := geo.NormalizeProviderLocation(
		firstNonEmpty(node.Country, ns.getCountryFromRegion(region)),
		node.City,
	)
	if country != "" && country != node.Country {
		node.Country = country
		_ = ns.db.Model(&node).Update("country", country).Error
	}
	if cityHint != "" && node.City == "" {
		node.City = cityHint
		_ = ns.db.Model(&node).Update("city", cityHint).Error
	}

	var (
		lat, lon  float64
		city, isp string
	)
	providerUpdates := map[string]interface{}{}
	ipRegion := region
	explicitCountry := country
	explicitCity := firstNonEmpty(node.City, cityHint)
	if effectiveIP != "" {
		if geoResult, ok := geoip.Resolve(effectiveIP); ok {
			ipCountry := ""
			if countryCode := geo.NormalizeCountryCode(geoResult.Country); countryCode != "" {
				ipCountry = countryCode
			}
			if geoip.IsCloudHostedISP(geoResult.ISP) {
				// Cloud MaxMind must never drive map pins when we have (or expect)
				// a residential provider location.
				lat, lon = 0, 0
				city = ""
			} else {
				isp = geoResult.ISP
				lat, lon = geoResult.Latitude, geoResult.Longitude
				// Prefer a declared city (Bibiani / Western North) over IP-city
				// snaps (often Accra for Ghana mobile egress).
				if explicitCity == "" {
					city = geoResult.City
				}
				if explicitCountry == "" {
					country = ipCountry
				} else if ipCountry != "" && ipCountry != explicitCountry {
					lat, lon = 0, 0
					city = ""
				}
				if geoResult.Region != "" && (region == "" || region == "unknown") && explicitCity == "" {
					ipRegion = geoResult.Region
					region = geoResult.Region
					if node.Region == "" && (explicitCountry == "" || ipCountry == "" || ipCountry == explicitCountry) {
						providerUpdates["region"] = geoResult.Region
						node.Region = geoResult.Region
					}
				}
			}
		}
	}
	if isp == "" {
		if !geoip.IsCloudHostedISP(node.ISP) {
			isp = node.ISP
		}
	} else if isp != node.ISP && !geoip.IsCloudHostedISP(isp) {
		providerUpdates["isp"] = isp
		node.ISP = isp
	}
	if explicitCountry != "" {
		country = explicitCountry
	}
	if country != "" && country != node.Country {
		providerUpdates["country"] = country
		node.Country = country
	}
	ipCity := city
	// Declared region wins for hub selection (Western North → Bibiani).
	hubRegion := firstNonEmpty(node.Region, region)
	if hubRegion == "unknown" {
		hubRegion = ipRegion
	}
	// lat/lon here come only from this tick's IP lookup, never from the stored
	// pin, and a declared city is kept even when the pin uses a nearby hub.
	pinCountry := firstNonEmpty(node.Country, country)
	hubCity, hubLat, hubLon, hubOK := geo.NodeHub(pinCountry, explicitCity, hubRegion, lat, lon)
	if hubOK {
		city = hubCity
		lat, lon = hubLat, hubLon
	} else {
		city = firstNonEmpty(hubCity, ipCity)
		if math.Abs(lat) < 0.01 && math.Abs(lon) < 0.01 {
			if clat, clon, ok := geo.CityCentroid(city, pinCountry); ok && city != "" {
				lat, lon = clat, clon
			} else if clat, clon, ok := geo.CountryCentroid(pinCountry, node.ID.String()); ok {
				lat, lon = clat, clon
			}
		}
	}
	if city != "" && city != node.City {
		providerUpdates["city"] = city
		node.City = city
	}
	if len(providerUpdates) > 0 {
		if err := ns.db.Model(&node).Updates(providerUpdates).Error; err != nil {
			logging.Debug().Err(err).Str("node_id", node.ID.String()).Msg("[NodeSync] provider node geo update skipped")
		}
	}

	// Get provider info
	var providerID string
	var providerUsername string
	if node.UserID != uuid.Nil {
		providerID = node.UserID.String()
		var provider models.User
		if err := ns.db.Where("id = ?", node.UserID).First(&provider).Error; err == nil {
			if provider.Username != nil {
				providerUsername = *provider.Username
			}
		}
	}

	mapCountry := firstNonEmpty(node.Country, country, ns.getCountryFromRegion(region))
	mapCity := city
	mapLat, mapLon := lat, lon
	mapIP := effectiveIP
	if mapIP == "" || geoip.IsControlPlanePublicIP(mapIP) || geoip.IsUntrustedGatewayGeo(mapIP, isp) {
		mapIP = ""
	}
	// Preserve a previously corrected residential hub when this sync tick has no
	// trustworthy IP geo (classic race: gateway re-advertises GCP WAN → Chicago).
	// Never when the owner set the location, and never to keep a city the node
	// no longer has (that resurrected an old "Kumasi" snap after a correction).
	if explorerNode.ID != uuid.Nil && !node.LocationUserSet && strings.EqualFold(strings.TrimSpace(explorerNode.City), mapCity) {
		existingCountry := geo.NormalizeCountryCode(explorerNode.Country)
		incomingCountry := geo.NormalizeCountryCode(mapCountry)
		existingHubOK := math.Abs(explorerNode.Latitude) > 0.01 && math.Abs(explorerNode.Longitude) > 0.01
		incomingWeak := math.Abs(mapLat) < 0.01 && math.Abs(mapLon) < 0.01
		cloudFlip := existingCountry != "" && incomingCountry != "" && existingCountry != incomingCountry &&
			(geoip.IsCloudHostedISP(isp) || mapIP == "")
		poisonedExisting := existingCountry == "US" && strings.EqualFold(explorerNode.City, "Chicago")
		if existingHubOK && !poisonedExisting && (incomingWeak || cloudFlip) {
			mapCountry = explorerNode.Country
			mapCity = explorerNode.City
			mapLat = explorerNode.Latitude
			mapLon = explorerNode.Longitude
			if region == "" || region == "unknown" {
				region = explorerNode.Region
			}
		}
	}

	explorerNodeData := models.ExplorerNode{
		NodeID:           node.ID.String(),
		Chain:            "solana",
		Name:             ns.getNodeName(node),
		IP:               mapIP,
		Region:           region,
		Country:          mapCountry,
		City:             mapCity,
		ISP:              isp,
		Latitude:         mapLat,
		Longitude:        mapLon,
		IsActive:         node.IsHealthy || node.Status == models.NodeOnline,
		IsValidator:      isValidator,
		UptimePercent:    uptime,
		TotalBandwidth:   bandwidth,
		ActiveSessions:   stats.ActiveSessions,
		ProviderUserID:   providerID,
		ProviderUsername: providerUsername,
		LastHeartbeat:    providerNodeLastSeen(node),
		Version:          "", // Node model doesn't have Version field
	}

	if explorerNode.ID == uuid.Nil {
		// Create new
		explorerNodeData.ID = uuid.New()
		if err := ns.db.Create(&explorerNodeData).Error; err != nil {
			return err
		}
	} else {
		// Update existing. A map, not the struct: GORM skips zero-valued
		// struct fields, so counts could rise but never return to 0 (audit D5).
		if err := ns.db.Model(&explorerNode).Updates(explorerNodeSyncValues(explorerNodeData)).Error; err != nil {
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
func (ns *NodeSync) calculateNodeUptime(node models.ProviderNode) float64 {
	if node.LastSeenAt == nil || node.LastSeenAt.IsZero() {
		return 0.0
	}

	timeSinceLastSeen := time.Since(*node.LastSeenAt)

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
func (ns *NodeSync) markInactiveNodes(activeNodes []models.ProviderNode) error {
	activeIDs := make([]string, len(activeNodes))
	for i, node := range activeNodes {
		activeIDs[i] = node.ID.String()
	}

	if len(activeIDs) == 0 {
		// No active nodes, mark all as inactive
		if err := ns.db.Model(&models.ExplorerNode{}).
			Where("is_active = ?", true).
			Update("is_active", false).Error; err != nil {
			return err
		}
	} else {
		// Mark nodes not in active list as inactive
		if err := ns.db.Model(&models.ExplorerNode{}).
			Where("node_id NOT IN ?", activeIDs).
			Update("is_active", false).Error; err != nil {
			return err
		}
	}

	// Drop map footprints for soft-deleted provider nodes (node_id = provider_nodes.id).
	return ns.db.Exec(`
		DELETE FROM explorer_nodes en
		WHERE EXISTS (
			SELECT 1 FROM provider_nodes pn
			WHERE pn.id::text = en.node_id
			  AND pn.deleted_at IS NOT NULL
		)
	`).Error
}

// getNodeName gets a display name for the node
func (ns *NodeSync) getNodeName(node models.ProviderNode) string {
	// Try to get provider name
	var provider models.User
	if err := ns.db.Where("id = ?", node.UserID).First(&provider).Error; err == nil {
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

// getCountryFromRegion maps a region to an ISO-3166 alpha-2 country code.
func (ns *NodeSync) getCountryFromRegion(region string) string {
	regionMap := map[string]string{
		"us-east":      "US",
		"us-west":      "US",
		"eu-west":      "IE",
		"eu-central":   "DE",
		"ap-south":     "IN",
		"ap-southeast": "SG",
		"ap-northeast": "JP",
		"sa-east":      "BR",
		"af-south":     "ZA",
	}

	if country, ok := regionMap[region]; ok {
		return country
	}

	return geo.NormalizeCountryCode(region)
}

// SyncNodeNow immediately syncs a specific node (for use by other services)
func (ns *NodeSync) SyncNodeNow(nodeID string) error {
	var node models.ProviderNode
	if err := ns.db.Where("id = ?", nodeID).First(&node).Error; err != nil {
		return err
	}

	stats := ns.getSessionStats()
	return ns.syncNode(node, stats[nodeID])
}

// explorerNodeSyncValues is the column set node sync owns on explorer_nodes,
// as a map so GORM writes zero values instead of skipping them (audit D5).
// Columns sync does not own (geo_source, geo_resolved_at, stake_amount,
// commission_rate) are absent and stay untouched. provider_user_id is written
// only when known: "" is invalid for the uuid column. last_heartbeat is
// written only when the node has been seen, so syncing a never-seen node does
// not erase a stored heartbeat.
func explorerNodeSyncValues(data models.ExplorerNode) map[string]interface{} {
	values := map[string]interface{}{
		"chain":             data.Chain,
		"name":              data.Name,
		"ip":                data.IP,
		"region":            data.Region,
		"country":           data.Country,
		"city":              data.City,
		"isp":               data.ISP,
		"latitude":          data.Latitude,
		"longitude":         data.Longitude,
		"is_active":         data.IsActive,
		"is_validator":      data.IsValidator,
		"uptime_percent":    data.UptimePercent,
		"total_bandwidth":   data.TotalBandwidth,
		"active_sessions":   data.ActiveSessions,
		"provider_username": data.ProviderUsername,
		"version":           data.Version,
	}
	if data.ProviderUserID != "" {
		values["provider_user_id"] = data.ProviderUserID
	}
	if !data.LastHeartbeat.IsZero() {
		values["last_heartbeat"] = data.LastHeartbeat
	}
	return values
}

func providerNodeLastSeen(node models.ProviderNode) time.Time {
	if node.LastSeenAt == nil {
		return time.Time{}
	}
	return *node.LastSeenAt
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// residentialIPForProvider picks a non-cloud public IP from the linked nodes
// table (real provider egress), ignoring control-plane / datacenter WAN.
func (ns *NodeSync) residentialIPForProvider(providerNodeID string) string {
	if providerNodeID == "" {
		return ""
	}
	var ips []string
	_ = ns.db.Raw(`
		SELECT DISTINCT TRIM(ip_address::text) AS ip
		FROM nodes
		WHERE deleted_at IS NULL
		  AND provider_node_id = ?::uuid
		  AND ip_address IS NOT NULL
		  AND TRIM(ip_address::text) <> ''
		ORDER BY ip
		LIMIT 8
	`, providerNodeID).Scan(&ips).Error
	for _, raw := range ips {
		ip := strings.TrimSuffix(strings.TrimSpace(raw), "/32")
		ip = geoip.PublicIPForGeo(ip)
		if ip == "" || geoip.IsControlPlanePublicIP(ip) {
			continue
		}
		if geoip.IsUntrustedGatewayGeo(ip, "") {
			continue
		}
		return ip
	}
	return ""
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
