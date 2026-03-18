// Package stats provides bandwidth and connection statistics tracking.
package stats

import (
	"sync"
	"sync/atomic"
	"time"
)

// Collector tracks runtime statistics for the provider node.
type Collector struct {
	// Connection stats
	activeConnections int32
	totalConnections  uint64

	// Bandwidth stats (bytes)
	bytesUp   uint64
	bytesDown uint64

	// System stats
	startTime     time.Time
	lastHeartbeat time.Time

	// Mutex for complex operations
	mu sync.RWMutex

	// Rate tracking (protected by mu)
	prevBytesUp      uint64
	prevBytesDown    uint64
	prevRateTime     time.Time
	cachedRateUpKbps uint32
	cachedRateDnKbps uint32
}

// NewCollector creates a new statistics collector.
func NewCollector() *Collector {
	now := time.Now()
	return &Collector{
		startTime:     now,
		lastHeartbeat: now,
		prevRateTime:  now,
	}
}

// RecordConnectionOpened records a new connection.
func (c *Collector) RecordConnectionOpened() {
	atomic.AddInt32(&c.activeConnections, 1)
	atomic.AddUint64(&c.totalConnections, 1)
}

// RecordConnectionClosed records a closed connection.
func (c *Collector) RecordConnectionClosed() {
	atomic.AddInt32(&c.activeConnections, -1)
}

// RecordBytesUp records uploaded bytes.
func (c *Collector) RecordBytesUp(bytes uint64) {
	atomic.AddUint64(&c.bytesUp, bytes)
}

// RecordBytesDown records downloaded bytes.
func (c *Collector) RecordBytesDown(bytes uint64) {
	atomic.AddUint64(&c.bytesDown, bytes)
}

// GetActiveConnections returns the current number of active connections.
func (c *Collector) GetActiveConnections() int32 {
	return atomic.LoadInt32(&c.activeConnections)
}

// GetTotalConnections returns the total number of connections.
func (c *Collector) GetTotalConnections() uint64 {
	return atomic.LoadUint64(&c.totalConnections)
}

// GetBytesUp returns total uploaded bytes.
func (c *Collector) GetBytesUp() uint64 {
	return atomic.LoadUint64(&c.bytesUp)
}

// GetBytesDown returns total downloaded bytes.
func (c *Collector) GetBytesDown() uint64 {
	return atomic.LoadUint64(&c.bytesDown)
}

// GetTotalBytes returns total bytes transferred.
func (c *Collector) GetTotalBytes() uint64 {
	return c.GetBytesUp() + c.GetBytesDown()
}

// GetUptime returns the node uptime.
func (c *Collector) GetUptime() time.Duration {
	return time.Since(c.startTime)
}

// UpdateHeartbeat updates the last heartbeat timestamp.
func (c *Collector) UpdateHeartbeat() {
	c.mu.Lock()
	c.lastHeartbeat = time.Now()
	c.mu.Unlock()
}

// GetLastHeartbeat returns the last heartbeat time.
func (c *Collector) GetLastHeartbeat() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.lastHeartbeat
}

// ComputeRate computes the current bandwidth rate in Kbps by comparing cumulative
// bytes against the previous call. Call at each heartbeat interval for fresh values.
func (c *Collector) ComputeRate() (upKbps, downKbps uint32) {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(c.prevRateTime).Seconds()
	if elapsed < 0.5 {
		return c.cachedRateUpKbps, c.cachedRateDnKbps
	}

	curUp := atomic.LoadUint64(&c.bytesUp)
	curDown := atomic.LoadUint64(&c.bytesDown)

	if elapsed > 0 {
		// 125 bytes/s == 1 Kbps
		c.cachedRateUpKbps = uint32(float64(curUp-c.prevBytesUp) / elapsed / 125)
		c.cachedRateDnKbps = uint32(float64(curDown-c.prevBytesDown) / elapsed / 125)
	}

	c.prevBytesUp = curUp
	c.prevBytesDown = curDown
	c.prevRateTime = now
	return c.cachedRateUpKbps, c.cachedRateDnKbps
}

// Snapshot returns a point-in-time capture of statistics including current rates.
func (c *Collector) Snapshot() Snapshot {
	upKbps, dnKbps := c.ComputeRate()
	return Snapshot{
		ActiveConnections: c.GetActiveConnections(),
		TotalConnections:  c.GetTotalConnections(),
		BytesUp:           c.GetBytesUp(),
		BytesDown:         c.GetBytesDown(),
		RateUpKbps:        upKbps,
		RateDownKbps:      dnKbps,
		UptimeSeconds:     uint64(c.GetUptime().Seconds()),
		LastHeartbeat:     c.GetLastHeartbeat(),
	}
}

// Snapshot is a point-in-time capture of statistics.
type Snapshot struct {
	ActiveConnections int32     `json:"active_connections"`
	TotalConnections  uint64    `json:"total_connections"`
	BytesUp           uint64    `json:"bytes_up"`
	BytesDown         uint64    `json:"bytes_down"`
	RateUpKbps        uint32    `json:"rate_up_kbps"`
	RateDownKbps      uint32    `json:"rate_down_kbps"`
	UptimeSeconds     uint64    `json:"uptime_seconds"`
	LastHeartbeat     time.Time `json:"last_heartbeat"`
}

// Reset resets all counters (useful for testing).
func (c *Collector) Reset() {
	atomic.StoreInt32(&c.activeConnections, 0)
	atomic.StoreUint64(&c.totalConnections, 0)
	atomic.StoreUint64(&c.bytesUp, 0)
	atomic.StoreUint64(&c.bytesDown, 0)
	c.startTime = time.Now()
}
