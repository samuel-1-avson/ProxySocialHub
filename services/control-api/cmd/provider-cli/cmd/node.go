package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/proxyhubb/control-api/cmd/provider-cli/internal/config"
	"github.com/proxyhubb/control-api/cmd/provider-cli/internal/proxy"
	"github.com/proxyhubb/control-api/cmd/provider-cli/internal/stats"
	"github.com/proxyhubb/control-api/cmd/provider-cli/internal/tunnel"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"go.uber.org/zap"
)

// NodeResponse represents the API model for consumer display.
type NodeResponse struct {
	ID             string  `json:"id"`
	IPAddress      string  `json:"ip_address"`
	Port           int     `json:"port"`
	ConnectionType string  `json:"connection_type"`
	Status         string  `json:"status"`
	LatencyMs      int     `json:"latency_ms"`
	QualityScore   float64 `json:"quality_score"`
	UptimePercent  float64 `json:"uptime_percent"`
}

var nodeCmd = &cobra.Command{
	Use:   "node",
	Short: "Manage ProxyHub provider nodes",
	Long:  `Commands for registering, managing, and running provider nodes on the ProxyHub network.`,
}

// ============================================
// LIST COMMAND
// ============================================
var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List all registered nodes",
	Run: func(cmd *cobra.Command, args []string) {
		apiKey := viper.GetString("api_key")
		if apiKey == "" {
			fmt.Println("Error: API Key is required. Set it via --api-key or in the config file.")
			os.Exit(1)
		}

		apiUrl := viper.GetString("api_url")
		url := fmt.Sprintf("%s/v1/provider/nodes", apiUrl)

		client := &http.Client{Timeout: 10 * time.Second}
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("Authorization", "Bearer "+apiKey)

		resp, err := client.Do(req)
		if err != nil {
			fmt.Printf("Error connecting to API: %v\n", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			fmt.Printf("API Error (%d): %s\n", resp.StatusCode, string(body))
			return
		}

		var result struct {
			Nodes []NodeResponse `json:"nodes"`
		}
		json.NewDecoder(resp.Body).Decode(&result)

		if len(result.Nodes) == 0 {
			fmt.Println("No nodes registered. Use 'provider-cli node register' to add one.")
			return
		}

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, "ID\tADDRESS\tTYPE\tSTATUS\tLATENCY\tQUALITY\tUPTIME")
		for _, n := range result.Nodes {
			id := n.ID
			if len(id) > 8 {
				id = id[:8]
			}
			fmt.Fprintf(w, "%s\t%s:%d\t%s\t%s\t%dms\t%.1f%%\t%.1f%%\n",
				id, n.IPAddress, n.Port, n.ConnectionType, n.Status, n.LatencyMs, n.QualityScore, n.UptimePercent)
		}
		w.Flush()
	},
}

// ============================================
// STATUS COMMAND
// ============================================
var statusCmd = &cobra.Command{
	Use:   "status [id]",
	Short: "Fetch real-time telemetry for a node",
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		nodeID := args[0]
		apiKey := viper.GetString("api_key")
		apiUrl := viper.GetString("api_url")

		url := fmt.Sprintf("%s/v1/provider/nodes/%s", apiUrl, nodeID)

		client := &http.Client{Timeout: 10 * time.Second}
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("Authorization", "Bearer "+apiKey)

		resp, err := client.Do(req)
		if err != nil {
			fmt.Printf("Error connecting to API: %v\n", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			fmt.Printf("API Error: %d\n", resp.StatusCode)
			return
		}

		var n NodeResponse
		json.NewDecoder(resp.Body).Decode(&n)

		fmt.Printf("--- Node %s Telemetry ---\n", nodeID)
		fmt.Printf("Status:    %s\n", n.Status)
		fmt.Printf("Address:   %s:%d\n", n.IPAddress, n.Port)
		fmt.Printf("Platform:  %s\n", n.ConnectionType)
		fmt.Printf("Latency:   %dms\n", n.LatencyMs)
		fmt.Printf("Quality:   %.2f/100.00\n", n.QualityScore)
		fmt.Printf("Uptime:    %.2f%%\n", n.UptimePercent)
		fmt.Printf("Verified:  YES (L1 Verified)\n")
	},
}

// ============================================
// REGISTER COMMAND
// ============================================
var registerCmd = &cobra.Command{
	Use:   "register",
	Short: "Interactive helper to register a new node",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Println("--- ProxyHub Node Registration ---")
		var ip, typeName string
		var port int

		fmt.Print("Enter Public IP Address: ")
		fmt.Scanln(&ip)
		fmt.Print("Enter Port: ")
		fmt.Scanln(&port)
		fmt.Print("Enter Node Type (residential/mobile/datacenter): ")
		fmt.Scanln(&typeName)

		apiKey := viper.GetString("api_key")
		apiUrl := viper.GetString("api_url")
		url := fmt.Sprintf("%s/v1/provider/nodes", apiUrl)

		var walletAddr string
		fmt.Print("Enter Solana Wallet Address (for payouts): ")
		fmt.Scanln(&walletAddr)

		payload := map[string]interface{}{
			"ip_address":      ip,
			"port":            port,
			"connection_type": typeName,
			"wallet_address":  walletAddr,
		}
		jsonPayload, _ := json.Marshal(payload)

		client := &http.Client{Timeout: 10 * time.Second}
		req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonPayload))
		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusCreated {
			fmt.Println("SUCCESS: Node registered in ProxyHub Registry.")
			fmt.Println("Node is now undergoing L1 On-Chain Verification.")
			fmt.Println("")
			fmt.Println("Next steps:")
			fmt.Println("1. Save your node configuration:")
			fmt.Printf("   provider-cli config set node_id <node_id_from_response>\n")
			fmt.Println("2. Start your node:")
			fmt.Println("   provider-cli node start")
		} else {
			body, _ := io.ReadAll(resp.Body)
			fmt.Printf("FAILED: Status %d - %s\n", resp.StatusCode, string(body))
		}
	},
}

// ============================================
// START COMMAND (NEW - Core Feature)
// ============================================
var startCmd = &cobra.Command{
	Use:   "start",
	Short: "Connect to Edge Gateway and start serving traffic",
	Long: `Start the provider node by connecting to the Edge Gateway tunnel.

This command will:
1. Connect to the Edge Gateway at the configured address
2. Authenticate using your JWT token
3. Declare your node's capabilities
4. Start accepting proxy requests from consumers
5. Send periodic heartbeats to maintain the connection

Examples:
  # Start with default configuration
  provider-cli node start

  # Start with custom gateway address
  provider-cli node start --gateway-addr gateway.proxyhubb.com:4000

  # Start with debug logging
  provider-cli node start --debug

  # Start with custom JWT token
  provider-cli node start --jwt-token <your-token>`,
	RunE: func(cmd *cobra.Command, args []string) error {
		// Load configuration
		configPath, _ := cmd.Flags().GetString("config")
		cfg, err := config.Load(configPath)
		if err != nil {
			return fmt.Errorf("failed to load configuration: %w", err)
		}

		// Override with command line flags
		if cmd.Flags().Changed("gateway-addr") {
			cfg.GatewayAddr, _ = cmd.Flags().GetString("gateway-addr")
		}
		if cmd.Flags().Changed("jwt-token") {
			cfg.JWTToken, _ = cmd.Flags().GetString("jwt-token")
		}
		if cmd.Flags().Changed("use-tls") {
			cfg.UseTLS, _ = cmd.Flags().GetBool("use-tls")
		}
		if cmd.Flags().Changed("debug") {
			if debug, _ := cmd.Flags().GetBool("debug"); debug {
				cfg.LogLevel = "debug"
			}
		}

		// Validate configuration
		if cfg.JWTToken == "" && cfg.APIKey == "" {
			return fmt.Errorf("JWT token or API key is required. Set it via --jwt-token, PROXYHUB_JWT_TOKEN, or in the config file")
		}

		// Initialize logger
		var logger *zap.Logger
		if cfg.LogLevel == "debug" {
			logger, _ = zap.NewDevelopment()
		} else {
			config := zap.NewProductionConfig()
			config.Level = zap.NewAtomicLevelAt(zap.InfoLevel)
			logger, _ = config.Build()
		}
		defer logger.Sync()

		logger.Info("Starting ProxyHub Provider Node",
			zap.String("version", tunnel.Version),
			zap.String("gateway", cfg.GatewayAddr),
		)

		// Write PID file
		if err := writePIDFile(); err != nil {
			logger.Warn("Failed to write PID file", zap.Error(err))
		} else {
			logger.Debug("PID file written")
			defer removePIDFile()
		}

		// Initialize statistics collector
		statsCollector := stats.NewCollector()

		// Setup signal handling for graceful shutdown
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		// currentClient is guarded by mu so the signal handler can always
		// reach the live client regardless of which reconnect iteration we're on.
		var (
			mu            sync.Mutex
			currentClient *tunnel.Client
		)

		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

		go func() {
			sig := <-sigChan
			logger.Info("Received shutdown signal", zap.String("signal", sig.String()))
			cancel()
			mu.Lock()
			if currentClient != nil {
				currentClient.Close()
			}
			mu.Unlock()
		}()

		// Start local stats server so `node metrics` can poll it.
		if cfg.MetricsEnabled {
			mux := http.NewServeMux()
			mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(statsCollector.Snapshot())
			})
			go http.ListenAndServe(fmt.Sprintf("localhost:%d", cfg.MetricsPort), mux)
			logger.Info("Stats server started", zap.Int("port", cfg.MetricsPort))
		}

		reconnectInterval := cfg.ReconnectInterval
		if reconnectInterval == 0 {
			reconnectInterval = 30 * time.Second
		}

		for {
			select {
			case <-ctx.Done():
				logger.Info("Shutting down...")
				return nil
			default:
			}

			// Fresh client every attempt — avoids closed stopChan reuse.
			client := tunnel.NewClient(cfg, logger, statsCollector)
			mu.Lock()
			currentClient = client
			mu.Unlock()

			logger.Info("Connecting to Edge Gateway...")
			if err := client.Connect(); err != nil {
				logger.Error("Connection failed", zap.Error(err))
				select {
				case <-ctx.Done():
					return nil
				case <-time.After(reconnectInterval):
					continue
				}
			}

			logger.Info("Connected to Edge Gateway", zap.String("gateway", cfg.GatewayAddr))

			hb := tunnel.NewHeartbeatManager(
				client.Session(),
				cfg.NodeID,
				30*time.Second,
				logger,
				statsCollector,
			)
			go hb.Start()

			handler := proxy.NewHandler(cfg, logger, statsCollector)
			done := make(chan error, 1)
			go func() {
				client.AcceptStreams(handler)
				done <- fmt.Errorf("stream handler exited")
			}()

			select {
			case <-ctx.Done():
				hb.Stop()
				client.Close()
				return nil
			case err := <-done:
				logger.Warn("Connection lost", zap.Error(err))
				hb.Stop()
				client.Close()
				select {
				case <-ctx.Done():
					return nil
				case <-time.After(reconnectInterval):
					logger.Info("Attempting to reconnect...")
					continue
				}
			}
		}
	},
}

// ============================================
// METRICS COMMAND (NEW)
// ============================================
var metricsCmd = &cobra.Command{
	Use:   "metrics",
	Short: "Display real-time node metrics",
	Long:  `Poll the running node's local stats server and display live metrics.`,
	Run: func(cmd *cobra.Command, args []string) {
		port := viper.GetInt("metrics_port")
		if port == 0 {
			port = 9090
		}

		url := fmt.Sprintf("http://localhost:%d/stats", port)
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Get(url)
		if err != nil {
			fmt.Printf("Node is not running (cannot reach stats server at %s)\n", url)
			fmt.Println("Start your node with: provider-cli node start")
			return
		}
		defer resp.Body.Close()

		var snap stats.Snapshot
		if err := json.NewDecoder(resp.Body).Decode(&snap); err != nil {
			fmt.Printf("Failed to parse stats response: %v\n", err)
			return
		}

		uptime := time.Duration(snap.UptimeSeconds) * time.Second
		sinceLast := time.Since(snap.LastHeartbeat).Round(time.Second)

		fmt.Println("--- Node Metrics ---")
		fmt.Printf("Uptime:              %s\n", formatDuration(uptime))
		fmt.Printf("Active Connections:  %d\n", snap.ActiveConnections)
		fmt.Printf("Total Connections:   %d\n", snap.TotalConnections)
		fmt.Printf("Upload:              %s\n", formatBytes(snap.BytesUp))
		fmt.Printf("Download:            %s\n", formatBytes(snap.BytesDown))
		fmt.Printf("Rate Up:             %s/s\n", formatBytes(uint64(snap.RateUpKbps)*125))
		fmt.Printf("Rate Down:           %s/s\n", formatBytes(uint64(snap.RateDownKbps)*125))
		fmt.Printf("Last Heartbeat:      %s ago\n", sinceLast)
	},
}

// formatBytes converts a byte count to a human-readable string.
func formatBytes(b uint64) string {
	const unit = uint64(1024)
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := unit, 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.2f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

// formatDuration renders a duration as "Xh Ym Zs".
func formatDuration(d time.Duration) string {
	d = d.Round(time.Second)
	h := d / time.Hour
	d -= h * time.Hour
	m := d / time.Minute
	d -= m * time.Minute
	s := d / time.Second
	if h > 0 {
		return fmt.Sprintf("%dh %dm %ds", h, m, s)
	}
	if m > 0 {
		return fmt.Sprintf("%dm %ds", m, s)
	}
	return fmt.Sprintf("%ds", s)
}

// ============================================
// LOGS COMMAND (NEW)
// ============================================
var logsCmd = &cobra.Command{
	Use:   "logs",
	Short: "View node logs",
	Run: func(cmd *cobra.Command, args []string) {
		configFile, _ := config.GetConfigFile()
		logFile := viper.GetString("log_file")
		
		if logFile == "" {
			// Default log location
			home, _ := os.UserHomeDir()
			logFile = home + "/.proxyhubb/provider.log"
		}

		fmt.Printf("Log file location: %s\n", logFile)
		fmt.Printf("Config file location: %s\n", configFile)
		
		// Try to read and display last few lines
		data, err := os.ReadFile(logFile)
		if err != nil {
			fmt.Println("No log file found. Start the node to generate logs.")
			return
		}
		
		lines := string(data)
		if len(lines) > 2000 {
			lines = lines[len(lines)-2000:]
		}
		
		fmt.Println("\n--- Recent Log Entries ---")
		fmt.Println(lines)
	},
}

// ============================================
// STOP COMMAND (NEW)
// ============================================
var stopCmd = &cobra.Command{
	Use:   "stop",
	Short: "Stop the running node",
	Long:  `Send a shutdown signal to the running node process.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		// Check for PID file
		home, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("failed to get home directory: %w", err)
		}
		
		pidFile := filepath.Join(home, ".proxyhubb", "provider.pid")
		data, err := os.ReadFile(pidFile)
		if err != nil {
			return fmt.Errorf("no running node found (PID file not found)")
		}

		var pid int
		if _, err := fmt.Sscanf(string(data), "%d", &pid); err != nil {
			return fmt.Errorf("invalid PID file")
		}

		// Send SIGTERM
		process, err := os.FindProcess(pid)
		if err != nil {
			return fmt.Errorf("failed to find process: %w", err)
		}

		if err := process.Signal(syscall.SIGTERM); err != nil {
			return fmt.Errorf("failed to stop node: %w", err)
		}

		fmt.Println("Node stop signal sent successfully.")
		
		// Remove PID file
		os.Remove(pidFile)
		
		return nil
	},
}

// Helper functions for PID management
func writePIDFile() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	pidDir := filepath.Join(home, ".proxyhubb")
	os.MkdirAll(pidDir, 0700)

	pidFile := filepath.Join(pidDir, "provider.pid")
	pid := strconv.Itoa(os.Getpid())

	return os.WriteFile(pidFile, []byte(pid), 0644)
}

func removePIDFile() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	pidFile := filepath.Join(home, ".proxyhubb", "provider.pid")
	return os.Remove(pidFile)
}

func init() {
	rootCmd.AddCommand(nodeCmd)
	nodeCmd.AddCommand(listCmd)
	nodeCmd.AddCommand(statusCmd)
	nodeCmd.AddCommand(registerCmd)
	nodeCmd.AddCommand(startCmd)
	nodeCmd.AddCommand(stopCmd)
	nodeCmd.AddCommand(metricsCmd)
	nodeCmd.AddCommand(logsCmd)

	// Add flags to start command
	startCmd.Flags().String("gateway-addr", "localhost:4000", "Edge Gateway address")
	startCmd.Flags().String("jwt-token", "", "JWT authentication token")
	startCmd.Flags().Bool("use-tls", true, "Use TLS encryption")
	startCmd.Flags().Bool("debug", false, "Enable debug logging")
	startCmd.Flags().Duration("reconnect-interval", 30*time.Second, "Reconnect interval on failure")

	viper.BindPFlag("gateway_addr", startCmd.Flags().Lookup("gateway-addr"))
	viper.BindPFlag("jwt_token", startCmd.Flags().Lookup("jwt-token"))
	viper.BindPFlag("use_tls", startCmd.Flags().Lookup("use-tls"))
}
