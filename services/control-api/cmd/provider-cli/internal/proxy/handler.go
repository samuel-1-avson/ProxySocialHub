// Package proxy handles HTTP CONNECT proxy requests from the Edge Gateway.
package proxy

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hashicorp/yamux"
	"github.com/proxyhubb/control-api/cmd/provider-cli/internal/config"
	"github.com/proxyhubb/control-api/cmd/provider-cli/internal/stats"
	"go.uber.org/zap"
)

// Handler handles incoming proxy requests from the Edge Gateway.
type Handler struct {
	config *config.Config
	logger *zap.Logger
	stats  *stats.Collector

	// Metrics
	activeConnections int32
	totalConnections  uint64
}

// NewHandler creates a new proxy handler.
func NewHandler(cfg *config.Config, logger *zap.Logger, stats *stats.Collector) *Handler {
	return &Handler{
		config: cfg,
		logger: logger,
		stats:  stats,
	}
}

// HandleStream handles a single yamux stream.
func (h *Handler) HandleStream(stream *yamux.Stream) {
	atomic.AddInt32(&h.activeConnections, 1)
	atomic.AddUint64(&h.totalConnections, 1)
	
	if h.stats != nil {
		h.stats.RecordConnectionOpened()
	}

	defer func() {
		atomic.AddInt32(&h.activeConnections, -1)
		if h.stats != nil {
			h.stats.RecordConnectionClosed()
		}
		stream.Close()
	}()

	// Set read timeout for command phase
	stream.SetReadDeadline(time.Now().Add(30 * time.Second))

	// Read the command
	reader := bufio.NewReader(stream)
	line, err := reader.ReadString('\n')
	if err != nil {
		h.logger.Debug("Failed to read command", zap.Error(err))
		return
	}

	// Clear deadline for data transfer
	stream.SetReadDeadline(time.Time{})

	line = strings.TrimSpace(line)
	parts := strings.SplitN(line, " ", 2)
	if len(parts) != 2 {
		h.writeError(stream, "Invalid command format")
		return
	}

	cmd, target := parts[0], parts[1]

	switch cmd {
	case "CONNECT":
		h.handleConnect(stream, target)
	case "STATS":
		h.handleStats(stream)
	case "PING":
		h.handlePing(stream)
	default:
		h.writeError(stream, "Unknown command: "+cmd)
	}
}

// handleConnect handles HTTP CONNECT proxy requests.
func (h *Handler) handleConnect(stream *yamux.Stream, target string) {
	h.logger.Debug("CONNECT request", zap.String("target", target))

	// Validate target
	if !h.isValidTarget(target) {
		h.logger.Warn("Invalid target rejected", zap.String("target", target))
		h.writeError(stream, "Invalid target: access denied")
		return
	}

	// Check port against allowed list
	if !h.isPortAllowed(target) {
		h.logger.Warn("Port not allowed", zap.String("target", target))
		h.writeError(stream, "Port not allowed")
		return
	}

	// Check blocked hosts
	if h.isHostBlocked(target) {
		h.logger.Warn("Host blocked", zap.String("target", target))
		h.writeError(stream, "Host blocked")
		return
	}

	// Connect to target
	start := time.Now()
	targetConn, err := net.DialTimeout("tcp", target, 10*time.Second)
	if err != nil {
		h.logger.Error("Failed to connect to target",
			zap.String("target", target),
			zap.Error(err),
		)
		h.writeError(stream, "Connection failed: "+err.Error())
		return
	}
	defer targetConn.Close()

	connectTime := time.Since(start)
	h.logger.Debug("Target connected",
		zap.String("target", target),
		zap.Duration("connect_time", connectTime),
	)

	// Send OK response
	if _, err := stream.Write([]byte("OK\n")); err != nil {
		h.logger.Debug("Failed to send OK response", zap.Error(err))
		return
	}

	// Bridge the connections
	h.bridge(stream, targetConn, target)
}

// bridge bidirectionally forwards data between client and target.
func (h *Handler) bridge(client io.ReadWriteCloser, target io.ReadWriteCloser, targetAddr string) {
	var wg sync.WaitGroup
	wg.Add(2)

	// CloseWriter allows half-close of a TCP connection after the write side is done.
	type CloseWriter interface {
		CloseWrite() error
	}

	// Client -> Target
	go func() {
		defer wg.Done()
		n, _ := io.Copy(target, client)
		if h.stats != nil && n > 0 {
			h.stats.RecordBytesUp(uint64(n))
		}
		// Signal other direction to close (half-close if supported)
		if cw, ok := target.(CloseWriter); ok {
			cw.CloseWrite()
		} else {
			target.Close()
		}
	}()

	// Target -> Client
	go func() {
		defer wg.Done()
		n, _ := io.Copy(client, target)
		if h.stats != nil && n > 0 {
			h.stats.RecordBytesDown(uint64(n))
		}
		client.Close()
	}()

	wg.Wait()
}

// handleStats handles STATS command (returns node statistics).
func (h *Handler) handleStats(stream *yamux.Stream) {
	var snapshot stats.Snapshot
	if h.stats != nil {
		snapshot = h.stats.Snapshot()
	}

	response := fmt.Sprintf("ACTIVE:%d UP:%d DOWN:%d TOTAL:%d\n",
		snapshot.ActiveConnections,
		snapshot.BytesUp,
		snapshot.BytesDown,
		snapshot.TotalConnections,
	)

	stream.Write([]byte(response))
}

// handlePing handles PING command.
func (h *Handler) handlePing(stream *yamux.Stream) {
	stream.Write([]byte("PONG\n"))
}

// isValidTarget validates the target address.
func (h *Handler) isValidTarget(target string) bool {
	host, port, err := net.SplitHostPort(target)
	if err != nil {
		return false
	}

	if host == "" || port == "" {
		return false
	}

	// Parse IP to check for private ranges
	ip := net.ParseIP(host)
	if ip != nil {
		// Block loopback
		if ip.IsLoopback() {
			return false
		}

		// Block link-local
		if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return false
		}

		// Block private IPs (RFC 1918)
		if ip.IsPrivate() {
			return false
		}
	}

	return true
}

// isPortAllowed checks if the target port is in the allowed list.
func (h *Handler) isPortAllowed(target string) bool {
	_, portStr, err := net.SplitHostPort(target)
	if err != nil {
		return false
	}

	var port uint16
	if _, err := fmt.Sscanf(portStr, "%d", &port); err != nil {
		return false
	}

	// Check against allowed ports
	for _, allowed := range h.config.AllowedPorts {
		if port == allowed {
			return true
		}
	}

	return false
}

// isHostBlocked checks if the host is in the blocked list.
func (h *Handler) isHostBlocked(target string) bool {
	host, _, err := net.SplitHostPort(target)
	if err != nil {
		return false
	}

	hostLower := strings.ToLower(host)

	for _, blocked := range h.config.BlockedHosts {
		if strings.Contains(hostLower, strings.ToLower(blocked)) {
			return true
		}
	}

	return false
}

// writeError writes an error response to the stream.
func (h *Handler) writeError(w io.Writer, msg string) {
	fmt.Fprintf(w, "ERROR %s\n", msg)
}

// GetActiveConnections returns the current number of active connections.
func (h *Handler) GetActiveConnections() int32 {
	return atomic.LoadInt32(&h.activeConnections)
}

// GetTotalConnections returns the total number of connections.
func (h *Handler) GetTotalConnections() uint64 {
	return atomic.LoadUint64(&h.totalConnections)
}

// ConnectionMetrics holds connection statistics.
type ConnectionMetrics struct {
	Active  int32
	Total   uint64
	BytesUp uint64
	BytesDown uint64
}

// GetMetrics returns current connection metrics.
func (h *Handler) GetMetrics() ConnectionMetrics {
	var bytesUp, bytesDown uint64
	if h.stats != nil {
		bytesUp = h.stats.GetBytesUp()
		bytesDown = h.stats.GetBytesDown()
	}

	return ConnectionMetrics{
		Active:    h.GetActiveConnections(),
		Total:     h.GetTotalConnections(),
		BytesUp:   bytesUp,
		BytesDown: bytesDown,
	}
}
