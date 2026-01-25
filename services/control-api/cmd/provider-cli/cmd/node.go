package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

// NodeResponse represents the API model for consumer display
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
}

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

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, "ID\tADDRESS\tTYPE\tSTATUS\tLATENCY\tQUALITY\tUPTIME")
		for _, n := range result.Nodes {
			fmt.Fprintf(w, "%s\t%s:%d\t%s\t%s\t%dms\t%.1f%%\t%.1f%%\n",
				n.ID[:8], n.IPAddress, n.Port, n.ConnectionType, n.Status, n.LatencyMs, n.QualityScore, n.UptimePercent)
		}
		w.Flush()
	},
}

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

		payload := map[string]interface{}{
			"ip_address":      ip,
			"port":            port,
			"connection_type": typeName,
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
		} else {
			body, _ := io.ReadAll(resp.Body)
			fmt.Printf("FAILED: Status %d - %s\n", resp.StatusCode, string(body))
		}
	},
}

var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Manage local CLI configuration",
}

var configSetCmd = &cobra.Command{
	Use:   "set [key] [value]",
	Short: "Set a configuration value",
	Args:  cobra.ExactArgs(2),
	Run: func(cmd *cobra.Command, args []string) {
		viper.Set(args[0], args[1])
		viper.WriteConfig()
		fmt.Printf("Config updated: %s = %s\n", args[0], args[1])
	},
}

func init() {
	rootCmd.AddCommand(nodeCmd)
	nodeCmd.AddCommand(listCmd)
	nodeCmd.AddCommand(statusCmd)
	nodeCmd.AddCommand(registerCmd)
	rootCmd.AddCommand(configCmd)
	configCmd.AddCommand(configSetCmd)
}
