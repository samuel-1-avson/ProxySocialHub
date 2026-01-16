package health

import (
	"log"
	"net"
	"sync"
	"time"

	"github.com/proxyhubb/control-api/internal/audit"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// HealthMonitor manages provider health checks
type HealthMonitor struct {
	checkInterval    time.Duration
	unhealthyTimeout time.Duration
	stopChan         chan struct{}
	wg               sync.WaitGroup
	running          bool
	mu               sync.Mutex
}

// Config for health monitoring
type Config struct {
	CheckInterval    time.Duration // How often to check nodes
	UnhealthyTimeout time.Duration // How long before marking unhealthy
	AutoDeactivate   bool          // Auto-deactivate unhealthy nodes
}

// DefaultConfig returns sensible defaults
func DefaultConfig() Config {
	return Config{
		CheckInterval:    1 * time.Minute,
		UnhealthyTimeout: 5 * time.Minute,
		AutoDeactivate:   true,
	}
}

// Global health monitor instance
var monitor *HealthMonitor

// Start initializes and starts the health monitoring service
func Start(config Config) error {
	if monitor != nil && monitor.running {
		return nil // Already running
	}

	monitor = &HealthMonitor{
		checkInterval:    config.CheckInterval,
		unhealthyTimeout: config.UnhealthyTimeout,
		stopChan:         make(chan struct{}),
	}

	monitor.wg.Add(1)
	go monitor.run(config)
	monitor.running = true

	log.Printf("[HealthMonitor] Started with interval=%v, timeout=%v", config.CheckInterval, config.UnhealthyTimeout)
	return nil
}

// Stop stops the health monitoring service
func Stop() {
	if monitor == nil || !monitor.running {
		return
	}

	close(monitor.stopChan)
	monitor.wg.Wait()
	monitor.running = false
	log.Println("[HealthMonitor] Stopped")
}

// run is the main monitoring loop
func (m *HealthMonitor) run(config Config) {
	defer m.wg.Done()

	ticker := time.NewTicker(m.checkInterval)
	defer ticker.Stop()

	// Initial check
	m.checkAllNodes(config)

	for {
		select {
		case <-m.stopChan:
			return
		case <-ticker.C:
			m.checkAllNodes(config)
		}
	}
}

// checkAllNodes performs health checks on all registered nodes
func (m *HealthMonitor) checkAllNodes(config Config) {
	if db.DB == nil {
		return
	}

	var nodes []models.Node
	if result := db.DB.Find(&nodes); result.Error != nil {
		log.Printf("[HealthMonitor] Failed to fetch nodes: %v", result.Error)
		return
	}

	log.Printf("[HealthMonitor] Checking %d nodes", len(nodes))

	var wg sync.WaitGroup
	for i := range nodes {
		wg.Add(1)
		go func(node *models.Node) {
			defer wg.Done()
			m.checkNode(node, config)
		}(&nodes[i])
	}
	wg.Wait()
}

// checkNode performs a health check on a single node
func (m *HealthMonitor) checkNode(node *models.Node, config Config) {
	startTime := time.Now()
	isHealthy := false
	var latencyMs int

	// Perform TCP connection test
	if node.IPAddress != "" {
		port := "1080" // Default SOCKS5 port
		addr := net.JoinHostPort(node.IPAddress, port)

		conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
		if err == nil {
			isHealthy = true
			latencyMs = int(time.Since(startTime).Milliseconds())
			conn.Close()
		}
	} else {
		// If no IP, check if we've seen it recently
		if time.Since(node.LastSeenAt) < m.unhealthyTimeout {
			isHealthy = true
		}
	}

	// Track health change
	wasHealthy := node.IsHealthy
	now := time.Now()

	// Update node fields
	updates := map[string]interface{}{
		"is_healthy":   isHealthy,
		"latency_ms":   latencyMs,
		"last_seen_at": now,
	}

	// If node went from healthy to unhealthy
	if wasHealthy && !isHealthy {
		log.Printf("[HealthMonitor] Node %s became unhealthy", node.ID)

		// Check if it's been unhealthy long enough
		if config.AutoDeactivate {
			if time.Since(node.LastSeenAt) > m.unhealthyTimeout {
				log.Printf("[HealthMonitor] Node %s unhealthy for too long", node.ID)

				// Log the event
				audit.LogDirect(nil, "system", models.AuditNodeHealthChange, models.EntityNode, node.ID.String(), models.AuditDetails{
					"action":       "marked_unhealthy",
					"reason":       "unhealthy_timeout",
					"last_seen":    node.LastSeenAt,
					"timeout_mins": m.unhealthyTimeout.Minutes(),
				})
			}
		}
	}

	// If node recovered
	if !wasHealthy && isHealthy {
		log.Printf("[HealthMonitor] Node %s became healthy (latency: %dms)", node.ID, latencyMs)

		audit.LogDirect(nil, "system", models.AuditNodeHealthChange, models.EntityNode, node.ID.String(), models.AuditDetails{
			"action":     "recovered",
			"latency_ms": latencyMs,
		})
	}

	// Save updates
	db.DB.Model(node).Updates(updates)
}

// GetNodeHealthStats returns aggregate health statistics
func GetNodeHealthStats() NodeHealthStats {
	stats := NodeHealthStats{}

	if db.DB == nil {
		return stats
	}

	db.DB.Model(&models.Node{}).Count(&stats.TotalNodes)
	db.DB.Model(&models.Node{}).Where("is_healthy = ?", true).Count(&stats.HealthyNodes)
	db.DB.Model(&models.Node{}).Where("is_healthy = ?", false).Count(&stats.UnhealthyNodes)

	if stats.TotalNodes > 0 {
		stats.HealthyPercent = float64(stats.HealthyNodes) / float64(stats.TotalNodes) * 100
	}

	// Calculate average latency for healthy nodes
	var avgLatency float64
	db.DB.Model(&models.Node{}).Where("is_healthy = ?", true).
		Select("COALESCE(AVG(latency_ms), 0)").Scan(&avgLatency)
	stats.AvgLatencyMs = avgLatency

	return stats
}

// NodeHealthStats contains aggregate node health information
type NodeHealthStats struct {
	TotalNodes     int64   `json:"total_nodes"`
	HealthyNodes   int64   `json:"healthy_nodes"`
	UnhealthyNodes int64   `json:"unhealthy_nodes"`
	HealthyPercent float64 `json:"healthy_percent"`
	AvgLatencyMs   float64 `json:"avg_latency_ms"`
}

// ManualHealthCheck triggers an immediate health check for a specific node
func ManualHealthCheck(nodeID string) (*models.Node, error) {
	var node models.Node
	if result := db.DB.First(&node, "id = ?", nodeID); result.Error != nil {
		return nil, result.Error
	}

	if monitor != nil {
		monitor.checkNode(&node, DefaultConfig())
	}

	// Reload the node to get updated values
	db.DB.First(&node, "id = ?", nodeID)
	return &node, nil
}

// ReactivateNode manually reactivates a node by updating its health
func ReactivateNode(nodeID string) (*models.Node, error) {
	var node models.Node
	if result := db.DB.First(&node, "id = ?", nodeID); result.Error != nil {
		return nil, result.Error
	}

	now := time.Now()
	db.DB.Model(&node).Updates(map[string]interface{}{
		"is_healthy":   true,
		"last_seen_at": now,
	})

	return &node, nil
}
