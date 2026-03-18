// Package tunnel provides heartbeat functionality for the provider node.
package tunnel

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/hashicorp/yamux"
	"github.com/proxyhubb/control-api/cmd/provider-cli/internal/stats"
	"go.uber.org/zap"
)

// HeartbeatMessage represents the heartbeat payload sent to the gateway.
type HeartbeatMessage struct {
	NodeID            string         `json:"node_id"`
	Timestamp         int64          `json:"timestamp"`
	ActiveConnections int32          `json:"active_connections"`
	BandwidthUsage    BandwidthUsage `json:"bandwidth_usage"`
	SystemStats       SystemStats    `json:"system_stats"`
}

// BandwidthUsage represents bandwidth statistics.
type BandwidthUsage struct {
	BytesUp      uint64 `json:"bytes_up"`
	BytesDown    uint64 `json:"bytes_down"`
	RateUpKbps   uint32 `json:"rate_up_kbps"`
	RateDownKbps uint32 `json:"rate_down_kbps"`
}

// SystemStats represents system resource usage.
type SystemStats struct {
	CPUPercent    float32 `json:"cpu_percent"`
	MemoryPercent float32 `json:"memory_percent"`
	UptimeSeconds uint64  `json:"uptime_seconds"`
	Goroutines    int     `json:"goroutines"`
}

// HeartbeatManager manages periodic heartbeats to the gateway.
type HeartbeatManager struct {
	session      *yamux.Session
	nodeID       string
	interval     time.Duration
	logger       *zap.Logger
	stats        *stats.Collector
	stopChan     chan struct{}
	lastSent     time.Time
	isRunning    int32 // accessed atomically
}

// NewHeartbeatManager creates a new heartbeat manager.
func NewHeartbeatManager(session *yamux.Session, nodeID string, interval time.Duration, logger *zap.Logger, stats *stats.Collector) *HeartbeatManager {
	return &HeartbeatManager{
		session:  session,
		nodeID:   nodeID,
		interval: interval,
		logger:   logger,
		stats:    stats,
		stopChan: make(chan struct{}),
	}
}

// Start begins sending periodic heartbeats.
func (h *HeartbeatManager) Start() {
	if !atomic.CompareAndSwapInt32(&h.isRunning, 0, 1) {
		return
	}

	h.logger.Info("Starting heartbeat manager",
		zap.String("interval", h.interval.String()),
	)

	ticker := time.NewTicker(h.interval)
	defer ticker.Stop()

	// Send initial heartbeat
	if err := h.send(); err != nil {
		h.logger.Error("Initial heartbeat failed", zap.Error(err))
	}

	for {
		select {
		case <-ticker.C:
			if err := h.send(); err != nil {
				h.logger.Error("Heartbeat failed", zap.Error(err))
			}
		case <-h.stopChan:
			h.logger.Info("Heartbeat manager stopped")
			return
		}
	}
}

// Stop stops the heartbeat manager.
func (h *HeartbeatManager) Stop() {
	if !atomic.CompareAndSwapInt32(&h.isRunning, 1, 0) {
		return
	}
	close(h.stopChan)
}

// send sends a single heartbeat.
func (h *HeartbeatManager) send() error {
	stream, err := h.session.OpenStream()
	if err != nil {
		return fmt.Errorf("failed to open stream: %w", err)
	}
	defer stream.Close()

	msg := h.buildMessage()
	
	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal heartbeat: %w", err)
	}

	// Send as: HEARTBEAT:<node_id>:<timestamp>:<json>
	frame := fmt.Sprintf("HEARTBEAT:%s:%d:%s\n",
		msg.NodeID,
		msg.Timestamp,
		string(data),
	)

	if _, err := stream.Write([]byte(frame)); err != nil {
		return fmt.Errorf("failed to send heartbeat: %w", err)
	}

	h.lastSent = time.Now()
	
	// Update stats
	if h.stats != nil {
		h.stats.UpdateHeartbeat()
	}

	h.logger.Debug("Heartbeat sent",
		zap.Int32("active_connections", msg.ActiveConnections),
		zap.Uint64("bytes_up", msg.BandwidthUsage.BytesUp),
		zap.Uint64("bytes_down", msg.BandwidthUsage.BytesDown),
		zap.Uint32("rate_up_kbps", msg.BandwidthUsage.RateUpKbps),
		zap.Uint32("rate_down_kbps", msg.BandwidthUsage.RateDownKbps),
	)

	return nil
}

// buildMessage constructs the heartbeat message.
func (h *HeartbeatManager) buildMessage() HeartbeatMessage {
	var bandwidth BandwidthUsage
	var activeConns int32
	
	if h.stats != nil {
		upKbps, downKbps := h.stats.ComputeRate()
		bandwidth = BandwidthUsage{
			BytesUp:      h.stats.GetBytesUp(),
			BytesDown:    h.stats.GetBytesDown(),
			RateUpKbps:   upKbps,
			RateDownKbps: downKbps,
		}
		activeConns = h.stats.GetActiveConnections()
	}

	return HeartbeatMessage{
		NodeID:            h.nodeID,
		Timestamp:         time.Now().Unix(),
		ActiveConnections: activeConns,
		BandwidthUsage:    bandwidth,
		SystemStats:       h.collectSystemStats(),
	}
}

// collectSystemStats gathers system statistics.
// On Linux, CPUPercent is sampled from /proc/stat over a 100 ms window.
// On other platforms it remains 0 (no extra dependencies required).
func (h *HeartbeatManager) collectSystemStats() SystemStats {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	var memPercent float32
	if m.Sys > 0 {
		memPercent = float32(m.HeapInuse) / float32(m.Sys) * 100
	}

	return SystemStats{
		CPUPercent:    sampleCPUPercent(),
		MemoryPercent: memPercent,
		UptimeSeconds: uint64(h.stats.GetUptime().Seconds()),
		Goroutines:    runtime.NumGoroutine(),
	}
}

// sampleCPUPercent returns the CPU usage percentage over a ~100 ms window.
// Only implemented on Linux via /proc/stat; returns 0 on other platforms.
func sampleCPUPercent() float32 {
	if runtime.GOOS != "linux" {
		return 0.0
	}
	s1 := readProcStat()
	time.Sleep(100 * time.Millisecond)
	s2 := readProcStat()

	// /proc/stat cpu line: user nice system idle iowait irq softirq
	total1 := s1[0] + s1[1] + s1[2] + s1[3] + s1[4] + s1[5] + s1[6]
	total2 := s2[0] + s2[1] + s2[2] + s2[3] + s2[4] + s2[5] + s2[6]
	deltaTotal := total2 - total1
	if deltaTotal == 0 {
		return 0.0
	}
	deltaIdle := s2[3] - s1[3]
	return float32(deltaTotal-deltaIdle) / float32(deltaTotal) * 100
}

// readProcStat reads the first cpu line of /proc/stat and returns the first 7
// jiffie counters: [user, nice, system, idle, iowait, irq, softirq].
func readProcStat() [7]uint64 {
	var vals [7]uint64
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return vals
	}
	for _, line := range strings.SplitN(string(data), "\n", 3) {
		if strings.HasPrefix(line, "cpu ") {
			fields := strings.Fields(line)
			for i := 1; i <= 7 && i < len(fields); i++ {
				vals[i-1], _ = strconv.ParseUint(fields[i], 10, 64)
			}
			break
		}
	}
	return vals
}

// LastSent returns the timestamp of the last successful heartbeat.
func (h *HeartbeatManager) LastSent() time.Time {
	return h.lastSent
}

// IsRunning returns whether the heartbeat manager is running.
func (h *HeartbeatManager) IsRunning() bool {
	return atomic.LoadInt32(&h.isRunning) == 1
}
