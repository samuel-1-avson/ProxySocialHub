// Package tunnel provides the Edge Gateway tunnel connection client.
package tunnel

import (
	"bufio"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hashicorp/yamux"
	"github.com/proxyhubb/control-api/cmd/provider-cli/internal/config"
	"github.com/proxyhubb/control-api/cmd/provider-cli/internal/stats"
	"go.uber.org/zap"
)

// Version is the CLI version sent during capability declaration.
const Version = "1.0.0"

// CapabilityInfo represents the provider's capabilities.
type CapabilityInfo struct {
	MaxConnections    uint32   `json:"max_connections"`
	MaxBandwidthMbps  uint32   `json:"max_bandwidth_mbps"`
	AvailablePorts    []uint16 `json:"available_ports"`
	ConnectionType    string   `json:"connection_type"`
	UplinkSpeedKbps   uint32   `json:"uplink_speed_kbps"`
	DownlinkSpeedKbps uint32   `json:"downlink_speed_kbps"`
	CPUCores          uint32   `json:"cpu_cores"`
	MemoryMB          uint64   `json:"memory_mb"`
	OS                string   `json:"os"`
	ClientVersion     string   `json:"client_version"`
	Features          []string `json:"features"`
}

// AssignedLimits represents the limits assigned by the gateway.
type AssignedLimits struct {
	MaxConnections    uint32   `json:"max_connections"`
	BandwidthCapMbps  uint32   `json:"bandwidth_cap_mbps"`
	AllowedPorts      []uint16 `json:"allowed_ports"`
	QOSTier           string   `json:"qos_tier"`
	Priority          uint32   `json:"priority"`
}

// Client manages the connection to the Edge Gateway.
type Client struct {
	config    *config.Config
	logger    *zap.Logger
	stats     *stats.Collector

	// Connection state
	conn       net.Conn
	session    *yamux.Session
	isRunning  int32
	isConnected int32

	// Assigned limits from gateway
	limits AssignedLimits

	// Callbacks
	onConnect    func()
	onDisconnect func(error)
	onError      func(error)

	// Control
	stopChan chan struct{}
	wg       sync.WaitGroup
	mu       sync.RWMutex
}

// NewClient creates a new tunnel client.
func NewClient(cfg *config.Config, logger *zap.Logger, stats *stats.Collector) *Client {
	return &Client{
		config:   cfg,
		logger:   logger,
		stats:    stats,
		stopChan: make(chan struct{}),
	}
}

// SetCallbacks sets the event callbacks.
func (c *Client) SetCallbacks(onConnect func(), onDisconnect func(error), onError func(error)) {
	c.onConnect = onConnect
	c.onDisconnect = onDisconnect
	c.onError = onError
}

// Connect establishes a connection to the Edge Gateway.
func (c *Client) Connect() error {
	if !atomic.CompareAndSwapInt32(&c.isRunning, 0, 1) {
		return fmt.Errorf("client is already running")
	}

	c.logger.Info("Connecting to Edge Gateway",
		zap.String("addr", c.config.GatewayAddr),
		zap.Bool("tls", c.config.UseTLS),
	)

	// 1. TCP Connection
	dialer := &net.Dialer{
		Timeout: c.config.ConnectTimeout,
	}

	conn, err := dialer.Dial("tcp", c.config.GatewayAddr)
	if err != nil {
		atomic.StoreInt32(&c.isRunning, 0)
		return fmt.Errorf("tcp dial failed: %w", err)
	}

	// 2. TLS Handshake (if enabled)
	if c.config.UseTLS {
		tlsConfig := &tls.Config{
			ServerName:         c.getServerName(),
			InsecureSkipVerify: c.config.TLSSkipVerify,
		}
		if c.config.TLSCertPath != "" {
			caCert, err := os.ReadFile(c.config.TLSCertPath)
			if err != nil {
				conn.Close()
				atomic.StoreInt32(&c.isRunning, 0)
				return fmt.Errorf("failed to read TLS cert %s: %w", c.config.TLSCertPath, err)
			}
			pool := x509.NewCertPool()
			if !pool.AppendCertsFromPEM(caCert) {
				conn.Close()
				atomic.StoreInt32(&c.isRunning, 0)
				return fmt.Errorf("failed to parse TLS cert from %s (not valid PEM?)", c.config.TLSCertPath)
			}
			tlsConfig.RootCAs = pool
			c.logger.Info("Custom CA cert loaded", zap.String("path", c.config.TLSCertPath))
		}
		conn = tls.Client(conn, tlsConfig)
	}

	c.conn = conn

	// 3. Yamux Session
	yamuxConfig := yamux.DefaultConfig()
	yamuxConfig.EnableKeepAlive = true
	yamuxConfig.KeepAliveInterval = 30 * time.Second
	yamuxConfig.ConnectionWriteTimeout = 10 * time.Second

	session, err := yamux.Client(conn, yamuxConfig)
	if err != nil {
		conn.Close()
		atomic.StoreInt32(&c.isRunning, 0)
		return fmt.Errorf("yamux client failed: %w", err)
	}
	c.session = session

	// 4. Authentication
	if err := c.authenticate(); err != nil {
		session.Close()
		conn.Close()
		atomic.StoreInt32(&c.isRunning, 0)
		return fmt.Errorf("authentication failed: %w", err)
	}

	// 5. Capability Declaration
	if err := c.declareCapabilities(); err != nil {
		session.Close()
		conn.Close()
		atomic.StoreInt32(&c.isRunning, 0)
		return fmt.Errorf("capability declaration failed: %w", err)
	}

	atomic.StoreInt32(&c.isConnected, 1)

	c.logger.Info("Successfully connected to Edge Gateway")

	if c.onConnect != nil {
		c.onConnect()
	}

	return nil
}

// authenticate performs the JWT authentication handshake.
func (c *Client) authenticate() error {
	stream, err := c.session.OpenStream()
	if err != nil {
		return fmt.Errorf("failed to open auth stream: %w", err)
	}
	defer stream.Close()

	// Send AUTH <token>
	token := c.config.JWTToken
	if token == "" {
		token = c.config.APIKey
	}

	authMsg := fmt.Sprintf("AUTH %s\n", token)
	if _, err := stream.Write([]byte(authMsg)); err != nil {
		return fmt.Errorf("failed to send auth: %w", err)
	}

	// Read response
	reader := bufio.NewReader(stream)
	response, err := reader.ReadString('\n')
	if err != nil {
		return fmt.Errorf("failed to read auth response: %w", err)
	}

	if response != "OK\n" {
		return fmt.Errorf("auth rejected: %s", response)
	}

	c.logger.Info("Authentication successful")
	return nil
}

// declareCapabilities sends the provider's capabilities to the gateway.
func (c *Client) declareCapabilities() error {
	stream, err := c.session.OpenStream()
	if err != nil {
		return fmt.Errorf("failed to open capability stream: %w", err)
	}
	defer stream.Close()

	caps := CapabilityInfo{
		MaxConnections:    c.config.MaxConnections,
		MaxBandwidthMbps:  c.config.BandwidthLimitMbps,
		AvailablePorts:    c.config.AllowedPorts,
		ConnectionType:    detectConnectionType(),
		UplinkSpeedKbps:   c.config.BandwidthLimitMbps * 1000 / 2, // Estimate
		DownlinkSpeedKbps: c.config.BandwidthLimitMbps * 1000,
		CPUCores:          uint32(runtime.NumCPU()),
		MemoryMB:          getMemoryMB(),
		OS:                runtime.GOOS,
		ClientVersion:     Version,
		Features:          []string{"ipv4", "http_connect", "bandwidth_reporting"},
	}

	capsJSON, err := json.Marshal(caps)
	if err != nil {
		return fmt.Errorf("failed to marshal capabilities: %w", err)
	}

	msg := fmt.Sprintf("CAPABILITY %s\n", string(capsJSON))
	if _, err := stream.Write([]byte(msg)); err != nil {
		return fmt.Errorf("failed to send capabilities: %w", err)
	}

	// Read ACK response
	reader := bufio.NewReader(stream)
	response, err := reader.ReadString('\n')
	if err != nil {
		return fmt.Errorf("failed to read capability response: %w", err)
	}

	// Parse ACK {"..."}
	if len(response) < 5 || response[:4] != "ACK " {
		return fmt.Errorf("unexpected capability response: %s", response)
	}

	var limits AssignedLimits
	if err := json.Unmarshal([]byte(response[4:]), &limits); err != nil {
		// Use default limits if parsing fails
		c.logger.Warn("Failed to parse assigned limits, using defaults", zap.Error(err))
		limits = AssignedLimits{
			MaxConnections:   c.config.MaxConnections,
			BandwidthCapMbps: c.config.BandwidthLimitMbps,
			AllowedPorts:     c.config.AllowedPorts,
			QOSTier:          "basic",
			Priority:         50,
		}
	}

	c.mu.Lock()
	c.limits = limits
	c.mu.Unlock()

	c.logger.Info("Capability declaration successful",
		zap.Uint32("max_connections", limits.MaxConnections),
		zap.String("qos_tier", limits.QOSTier),
		zap.Uint32("priority", limits.Priority),
	)

	return nil
}

// AcceptStreams starts accepting and handling incoming streams.
func (c *Client) AcceptStreams(handler StreamHandler) {
	c.wg.Add(1)
	defer c.wg.Done()

	for atomic.LoadInt32(&c.isRunning) == 1 {
		stream, err := c.session.AcceptStream()
		if err != nil {
			if atomic.LoadInt32(&c.isRunning) == 0 {
				// Normal shutdown
				return
			}
			c.logger.Error("Failed to accept stream", zap.Error(err))
			if c.onError != nil {
				c.onError(err)
			}
			continue
		}

		c.wg.Add(1)
		go func(s *yamux.Stream) {
			defer c.wg.Done()
			stats := c.stats
			if stats != nil {
				stats.RecordConnectionOpened()
				defer stats.RecordConnectionClosed()
			}
			handler.HandleStream(s)
		}(stream)
	}
}

// Session returns the underlying yamux session.
func (c *Client) Session() *yamux.Session {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.session
}

// IsConnected returns whether the client is connected.
func (c *Client) IsConnected() bool {
	return atomic.LoadInt32(&c.isConnected) == 1
}

// IsRunning returns whether the client is running.
func (c *Client) IsRunning() bool {
	return atomic.LoadInt32(&c.isRunning) == 1
}

// GetLimits returns the assigned limits from the gateway.
func (c *Client) GetLimits() AssignedLimits {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.limits
}

// Close gracefully closes the connection.
func (c *Client) Close() error {
	if !atomic.CompareAndSwapInt32(&c.isRunning, 1, 0) {
		return nil // Already stopped
	}

	c.logger.Info("Closing connection to Edge Gateway")

	close(c.stopChan)

	if c.session != nil {
		c.session.Close()
	}

	if c.conn != nil {
		c.conn.Close()
	}

	// Wait for all goroutines to finish with timeout
	done := make(chan struct{})
	go func() {
		c.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		c.logger.Info("All connections closed gracefully")
	case <-time.After(30 * time.Second):
		c.logger.Warn("Timeout waiting for connections to close")
	}

	atomic.StoreInt32(&c.isConnected, 0)

	if c.onDisconnect != nil {
		c.onDisconnect(nil)
	}

	return nil
}

// getServerName extracts the server name from the gateway address.
func (c *Client) getServerName() string {
	host, _, err := net.SplitHostPort(c.config.GatewayAddr)
	if err != nil {
		return c.config.GatewayAddr
	}
	return host
}

// detectConnectionType reads the connection type from config; defaults to "residential".
// Providers set this during wizard setup or via config file (connection_type field).
func detectConnectionType() string {
	if ct := os.Getenv("PROXYHUB_CONNECTION_TYPE"); ct != "" {
		return ct
	}
	return "residential"
}

// getMemoryMB returns the total system RAM in MB.
// On Linux it reads /proc/meminfo for an accurate value.
// On other platforms it falls back to the Go runtime heap size.
func getMemoryMB() uint64 {
	if runtime.GOOS == "linux" {
		data, err := os.ReadFile("/proc/meminfo")
		if err == nil {
			for _, line := range strings.SplitN(string(data), "\n", 10) {
				if strings.HasPrefix(line, "MemTotal:") {
					fields := strings.Fields(line)
					if len(fields) >= 2 {
						if kb, err := strconv.ParseUint(fields[1], 10, 64); err == nil {
							return kb / 1024
						}
					}
				}
			}
		}
	}
	// Fallback: report total memory obtained from the OS by the Go runtime.
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return m.Sys / (1024 * 1024)
}

// StreamHandler handles incoming yamux streams.
type StreamHandler interface {
	HandleStream(stream *yamux.Stream)
}
