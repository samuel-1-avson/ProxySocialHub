package cmd

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/cmd/provider-cli/internal/config"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

// wizardCmd provides an interactive setup wizard
var wizardCmd = &cobra.Command{
	Use:   "wizard",
	Short: "Interactive setup wizard for new providers",
	Long: `Run an interactive wizard to configure your ProxyHub provider node.

This wizard will guide you through:
1. API authentication setup
2. Node registration
3. Performance configuration
4. Service installation (optional)`,
	RunE: runWizard,
}

func runWizard(cmd *cobra.Command, args []string) error {
	reader := bufio.NewReader(os.Stdin)

	printBanner()

	// Step 1: Welcome
	fmt.Println("👋 Welcome to the ProxyHub Provider Setup Wizard!")
	fmt.Println()
	fmt.Println("This wizard will help you set up your node to start earning")
	fmt.Println("by sharing your internet bandwidth.")
	fmt.Println()
	
	if !confirm(reader, "Continue?") {
		fmt.Println("Setup cancelled.")
		return nil
	}

	// Step 2: API Credentials
	fmt.Println()
	fmt.Println("📋 Step 1: API Authentication")
	fmt.Println("You need an API key from your ProxyHub dashboard.")
	fmt.Println("Get one at: https://app.proxyhubb.io/settings/api")
	fmt.Println()

	apiKey := prompt(reader, "Enter your API Key")
	if apiKey == "" {
		fmt.Println("❌ API Key is required")
		return fmt.Errorf("API key required")
	}

	jwtToken := prompt(reader, "Enter your JWT Token (optional)")

	// Solana wallet for payouts
	fmt.Println()
	fmt.Println("💰 Solana Wallet Address (for receiving earnings payouts)")
	fmt.Println("   Get one free at: https://phantom.app or https://solflare.com")
	walletAddr := prompt(reader, "Enter your Solana wallet address")
	if walletAddr == "" {
		fmt.Println("⚠️  No wallet address provided — earnings won't be paid out until you set one.")
		fmt.Println("   Set later with: provider-cli config set wallet_address <address>")
	} else if !isValidSolanaAddress(walletAddr) {
		fmt.Println("⚠️  Address format looks invalid (expected 32–44 base58 characters).")
		fmt.Println("   You can update it later with: provider-cli config set wallet_address <address>")
	} else {
		fmt.Println("✓ Wallet address accepted")
	}

	// Step 3: Test connection
	fmt.Println()
	fmt.Println("🔗 Step 2: Testing Connection")
	fmt.Printf("Testing connection to ProxyHub API... ")

	apiURL := viper.GetString("api_url")
	if apiURL == "" {
		apiURL = "http://localhost:8081"
	}
	healthURL := strings.TrimRight(apiURL, "/") + "/health"
	httpClient := &http.Client{Timeout: 5 * time.Second}
	healthResp, healthErr := httpClient.Get(healthURL)
	if healthErr != nil {
		fmt.Printf("✗ Failed\n  → Cannot reach API at %s: %v\n", healthURL, healthErr)
		fmt.Println("Please ensure the ProxyHub API is running and reachable, then retry.")
		return fmt.Errorf("API unreachable: %w", healthErr)
	}
	healthResp.Body.Close()
	if healthResp.StatusCode >= 500 {
		fmt.Printf("✗ Failed (HTTP %d)\n", healthResp.StatusCode)
		return fmt.Errorf("API returned server error: %d", healthResp.StatusCode)
	}
	fmt.Printf("✓ OK (HTTP %d)\n", healthResp.StatusCode)

	// Step 4: Node Configuration
	fmt.Println()
	fmt.Println("⚙️  Step 3: Node Configuration")
	fmt.Println()

	connectionType := selectOption(reader, "Connection Type", []string{
		"residential - Home internet (recommended)",
		"mobile - Cellular/4G/5G",
		"datacenter - Server/cloud VPS",
		"fiber - Fiber optic connection",
	})

	// Extract just the key (before the dash)
	connType := strings.Split(connectionType, " - ")[0]

	// Step 5: Performance Settings
	fmt.Println()
	fmt.Println("🚀 Step 4: Performance Settings")
	fmt.Println()

	maxConnsStr := promptDefault(reader, "Maximum concurrent connections", "100")
	maxConns, _ := strconv.Atoi(maxConnsStr)
	if maxConns == 0 {
		maxConns = 100
	}

	bandwidthStr := promptDefault(reader, "Bandwidth limit (Mbps)", "100")
	bandwidth, _ := strconv.Atoi(bandwidthStr)
	if bandwidth == 0 {
		bandwidth = 100
	}

	// Step 6: Gateway Selection
	fmt.Println()
	fmt.Println("🌐 Step 5: Gateway Configuration")
	fmt.Println()

	gateway := promptDefault(reader, "Edge Gateway address", "gateway.proxyhubb.com:4000")
	useTLS := confirm(reader, "Use TLS encryption? (recommended)")

	// Step 7: Save configuration
	fmt.Println()
	fmt.Println("💾 Step 6: Saving Configuration")
	fmt.Println()

	cfg := &config.Config{
		APIKey:             apiKey,
		JWTToken:           jwtToken,
		WalletAddress:      walletAddr,
		GatewayAddr:        gateway,
		UseTLS:             useTLS,
		MaxConnections:     uint32(maxConns),
		BandwidthLimitMbps: uint32(bandwidth),
		LogLevel:           "info",
		MetricsEnabled:     true,
		MetricsPort:        9090,
	}

	// Set connection type based on selection
	switch connType {
	case "mobile":
		cfg.AllowedPorts = []uint16{80, 443}
	case "datacenter":
		cfg.AllowedPorts = []uint16{80, 443, 8080, 8443, 3128}
	default:
		cfg.AllowedPorts = []uint16{80, 443, 8080, 8443}
	}

	if err := cfg.Save(); err != nil {
		return fmt.Errorf("failed to save configuration: %w", err)
	}

	fmt.Println("✓ Configuration saved")

	// Step 8: Register node
	fmt.Println()
	fmt.Println("📝 Step 7: Node Registration")
	fmt.Println()
	
	if confirm(reader, "Register this node with ProxyHub now?") {
		fmt.Print("Registering node... ")
		regURL := strings.TrimRight(apiURL, "/") + "/v1/provider/nodes"
		payload := map[string]interface{}{
			"connection_type": connType,
			"wallet_address":  walletAddr,
		}
		jsonPayload, _ := json.Marshal(payload)
		regReq, _ := http.NewRequest("POST", regURL, bytes.NewBuffer(jsonPayload))
		token := cfg.JWTToken
		if token == "" {
			token = cfg.APIKey
		}
		regReq.Header.Set("Authorization", "Bearer "+token)
		regReq.Header.Set("Content-Type", "application/json")
		regResp, regErr := httpClient.Do(regReq)
		if regErr != nil {
			fmt.Printf("✗ Failed: %v\n", regErr)
			fmt.Println("  Register manually later with: provider-cli node register")
		} else {
			defer regResp.Body.Close()
			if regResp.StatusCode == http.StatusCreated || regResp.StatusCode == http.StatusOK {
				var result map[string]interface{}
				json.NewDecoder(regResp.Body).Decode(&result)
				fmt.Println("✓ Node registered")
				if id, ok := result["id"].(string); ok && id != "" {
					cfg.NodeID = id
					cfg.Save()
					fmt.Printf("  Node ID: %s\n", id)
				}
			} else {
				body, _ := io.ReadAll(regResp.Body)
				fmt.Printf("✗ Failed (HTTP %d): %s\n", regResp.StatusCode, string(body))
				fmt.Println("  Register manually later with: provider-cli node register")
			}
		}
	}

	// Exchange provider token for a gateway JWT so `node start` can authenticate
	fmt.Print("Fetching gateway token... ")
	gtURL := strings.TrimRight(apiURL, "/") + "/v1/provider/gateway-token"
	gtPayload, _ := json.Marshal(map[string]string{"token": cfg.APIKey})
	gtReq, _ := http.NewRequest("POST", gtURL, bytes.NewBuffer(gtPayload))
	gtReq.Header.Set("Content-Type", "application/json")
	if gtResp, gtErr := httpClient.Do(gtReq); gtErr == nil {
		defer gtResp.Body.Close()
		var gtResult map[string]interface{}
		if json.NewDecoder(gtResp.Body).Decode(&gtResult) == nil {
			if jwtVal, ok := gtResult["gateway_token"].(string); ok && jwtVal != "" {
				cfg.JWTToken = jwtVal
				cfg.Save()
				fmt.Println("✓ Done")
			} else {
				fmt.Println("⚠ Could not obtain gateway token (set jwt_token manually later)")
			}
		}
	} else {
		fmt.Printf("⚠ %v\n", gtErr)
	}

	// Step 9: Service Installation
	fmt.Println()
	fmt.Println("⚙️  Step 8: Auto-Start Configuration (Optional)")
	fmt.Println()
	fmt.Println("You can install the provider as a system service to automatically")
	fmt.Println("start on boot and restart on failure.")
	fmt.Println()

	if confirm(reader, "Install as system service?") {
		if err := installService(); err != nil {
			fmt.Printf("⚠️  Could not install service: %v\n", err)
			fmt.Println("You can manually start with: provider-cli node start")
		} else {
			fmt.Println("✓ Service installed successfully")
			fmt.Println("  Start: sudo systemctl start proxyhub-provider")
			fmt.Println("  Status: sudo systemctl status proxyhub-provider")
		}
	}

	// Final summary
	fmt.Println()
	printSummary(cfg)

	fmt.Println()
	fmt.Println("🎉 Setup Complete!")
	fmt.Println()
	fmt.Println("Next steps:")
	fmt.Println("  1. Start your node: provider-cli node start")
	fmt.Println("  2. View metrics:     provider-cli node metrics")
	fmt.Println("  3. View logs:        provider-cli node logs")
	fmt.Println()
	fmt.Println("Need help? Visit: https://docs.proxyhubb.io/provider")

	return nil
}

func printBanner() {
	fmt.Println()
	fmt.Println("╔════════════════════════════════════════════════════════════╗")
	fmt.Println("║              ProxyHub Provider Setup Wizard                ║")
	fmt.Println("║                                                            ║")
	fmt.Println("║  Turn your internet connection into passive income 🚀      ║")
	fmt.Println("╚════════════════════════════════════════════════════════════╝")
	fmt.Println()
}

func printSummary(cfg *config.Config) {
	fmt.Println("--- Configuration Summary ---")
	fmt.Printf("Gateway:        %s (TLS: %v)\n", cfg.GatewayAddr, cfg.UseTLS)
	fmt.Printf("Max Connections: %d\n", cfg.MaxConnections)
	fmt.Printf("Bandwidth Cap:   %d Mbps\n", cfg.BandwidthLimitMbps)
	fmt.Printf("Allowed Ports:   %v\n", cfg.AllowedPorts)
	fmt.Printf("Log Level:       %s\n", cfg.LogLevel)
	fmt.Printf("Metrics:         Enabled (port %d)\n", cfg.MetricsPort)
}

func prompt(reader *bufio.Reader, question string) string {
	fmt.Printf("%s: ", question)
	input, _ := reader.ReadString('\n')
	return strings.TrimSpace(input)
}

func promptDefault(reader *bufio.Reader, question, defaultValue string) string {
	fmt.Printf("%s [%s]: ", question, defaultValue)
	input, _ := reader.ReadString('\n')
	input = strings.TrimSpace(input)
	if input == "" {
		return defaultValue
	}
	return input
}

func confirm(reader *bufio.Reader, question string) bool {
	fmt.Printf("%s [Y/n]: ", question)
	input, _ := reader.ReadString('\n')
	input = strings.ToLower(strings.TrimSpace(input))
	return input == "" || input == "y" || input == "yes"
}

func selectOption(reader *bufio.Reader, question string, options []string) string {
	fmt.Printf("%s:\n", question)
	for i, opt := range options {
		fmt.Printf("  %d. %s\n", i+1, opt)
	}
	
	for {
		fmt.Print("Select option (1-" + strconv.Itoa(len(options)) + "): ")
		input, _ := reader.ReadString('\n')
		input = strings.TrimSpace(input)
		
		idx, err := strconv.Atoi(input)
		if err != nil || idx < 1 || idx > len(options) {
			fmt.Println("Invalid selection. Please try again.")
			continue
		}
		
		return options[idx-1]
	}
}

func installService() error {
	switch runtime.GOOS {
	case "linux":
		return installSystemdService()
	case "windows":
		return installWindowsService()
	default:
		return fmt.Errorf("auto-start not supported on %s — start manually with: provider-cli node start", runtime.GOOS)
	}
}

// isValidSolanaAddress performs a lightweight check on a Solana base58 address.
func isValidSolanaAddress(addr string) bool {
	if len(addr) < 32 || len(addr) > 44 {
		return false
	}
	const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
	for _, c := range addr {
		if !strings.ContainsRune(base58Alphabet, c) {
			return false
		}
	}
	return true
}

func init() {
	rootCmd.AddCommand(wizardCmd)
}
