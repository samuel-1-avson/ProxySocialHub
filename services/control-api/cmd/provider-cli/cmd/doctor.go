package cmd

import (
	"fmt"
	"net"
	"net/http"
	"runtime"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/cmd/provider-cli/internal/config"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

// doctorCmd provides diagnostic and troubleshooting
type doctorCmd struct {
	*cobra.Command
}

// newDoctorCmd creates the doctor command
func newDoctorCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "doctor",
		Short: "Run diagnostics and troubleshoot issues",
		Long: `Run comprehensive diagnostics on your provider node setup.

This command checks:
- Configuration validity
- Network connectivity
- API accessibility
- System requirements
- Port availability`,
		RunE: runDoctor,
	}
	return cmd
}

func runDoctor(cmd *cobra.Command, args []string) error {
	fmt.Println("🔍 Running ProxyHub Provider Diagnostics")
	fmt.Println()

	checks := []struct {
		name string
		fn   func() (bool, string)
	}{
		{"Configuration", checkConfig},
		{"Network Interface", checkNetwork},
		{"Gateway Connectivity", checkGateway},
		{"API Accessibility", checkAPI},
		{"System Resources", checkSystem},
		{"Port Availability", checkPorts},
	}

	passed := 0
	failed := 0

	for _, check := range checks {
		fmt.Printf("Checking %s... ", check.name)
		success, message := check.fn()
		
		if success {
			fmt.Println("✓ PASS")
			passed++
		} else {
			fmt.Println("✗ FAIL")
			fmt.Printf("  → %s\n", message)
			failed++
		}
	}

	fmt.Println()
	fmt.Println("--- Results ---")
	fmt.Printf("Passed: %d\n", passed)
	fmt.Printf("Failed: %d\n", failed)

	if failed > 0 {
		fmt.Println()
		fmt.Println("⚠️  Some checks failed. Please address the issues above.")
		fmt.Println("   For help, visit: https://docs.proxyhubb.io/troubleshooting")
		return fmt.Errorf("%d checks failed", failed)
	}

	fmt.Println()
	fmt.Println("✓ All checks passed! Your system is ready to run a provider node.")
	fmt.Println("  Start your node with: provider-cli node start")

	return nil
}

func checkConfig() (bool, string) {
	cfg, err := config.Load("")
	if err != nil {
		return false, fmt.Sprintf("Failed to load config: %v", err)
	}

	if cfg.APIKey == "" && cfg.JWTToken == "" {
		return false, "No API key or JWT token configured"
	}

	if cfg.GatewayAddr == "" {
		return false, "Gateway address not configured"
	}

	return true, "Configuration valid"
}

func checkNetwork() (bool, string) {
	// Check if we can determine our public IP
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return false, fmt.Sprintf("Failed to get network interfaces: %v", err)
	}

	hasIP := false
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() != nil {
				hasIP = true
				break
			}
		}
	}

	if !hasIP {
		return false, "No valid network interface found"
	}

	return true, "Network interface available"
}

func checkGateway() (bool, string) {
	cfg, _ := config.Load("")
	if cfg == nil {
		return false, "No configuration"
	}

	host, port, err := net.SplitHostPort(cfg.GatewayAddr)
	if err != nil {
		return false, fmt.Sprintf("Invalid gateway address: %v", err)
	}

	// Try to resolve the hostname
	addrs, err := net.LookupHost(host)
	if err != nil {
		return false, fmt.Sprintf("Cannot resolve gateway hostname: %v", err)
	}

	if len(addrs) == 0 {
		return false, "Gateway hostname resolved to no addresses"
	}

	// Try to connect
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(addrs[0], port), 5*time.Second)
	if err != nil {
		return false, fmt.Sprintf("Cannot connect to gateway: %v", err)
	}
	conn.Close()

	return true, fmt.Sprintf("Connected to %s", cfg.GatewayAddr)
}

func checkAPI() (bool, string) {
	cfg, _ := config.Load("")
	if cfg == nil || (cfg.APIKey == "" && cfg.JWTToken == "") {
		return false, "No API key or JWT token configured"
	}

	apiURL := viper.GetString("api_url")
	if apiURL == "" {
		apiURL = "http://localhost:8081"
	}

	healthURL := strings.TrimRight(apiURL, "/") + "/health"

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", healthURL, nil)
	if err != nil {
		return false, fmt.Sprintf("Failed to build request: %v", err)
	}

	token := cfg.JWTToken
	if token == "" {
		token = cfg.APIKey
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Sprintf("Cannot reach API at %s: %v", healthURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 500 {
		return false, fmt.Sprintf("API returned server error: HTTP %d", resp.StatusCode)
	}

	return true, fmt.Sprintf("API reachable at %s (HTTP %d)", healthURL, resp.StatusCode)
}

func checkSystem() (bool, string) {
	// Check OS
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" && runtime.GOOS != "windows" {
		return false, fmt.Sprintf("Unsupported OS: %s", runtime.GOOS)
	}

	// Check available memory (simplified)
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	return true, fmt.Sprintf("OS: %s, CPUs: %d", runtime.GOOS, runtime.NumCPU())
}

func checkPorts() (bool, string) {
	// Check if we can bind to common ports
	ports := []int{8080, 8888}
	
	for _, port := range ports {
		ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
		if err != nil {
			return false, fmt.Sprintf("Cannot bind to port %d: %v", port, err)
		}
		ln.Close()
	}

	return true, "Required ports available"
}

func init() {
	rootCmd.AddCommand(newDoctorCmd())
}
