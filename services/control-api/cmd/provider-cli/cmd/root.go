package cmd

import (
	"fmt"
	"os"

	"github.com/proxyhubb/control-api/cmd/provider-cli/internal/config"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var cfgFile string

var rootCmd = &cobra.Command{
	Use:   "provider-cli",
	Short: "Industrial CLI for ProxyHub Node Providers",
	Long: `A high-fidelity command line interface for managing distributed proxy nodes.

Zero mock data. Zero simulation. All signals are verified against the ProxyHub Control API.

Getting Started:
  1. Configure your credentials:
     provider-cli config set api_key <your-api-key>
     provider-cli config set jwt_token <your-jwt-token>

  2. Register your node:
     provider-cli node register

  3. Start serving traffic:
     provider-cli node start

Use "provider-cli [command] --help" for more information about a command.`,
	// Check for a newer CLI version on every invocation (non-blocking, ignores errors).
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		// Skip version check for update and version commands to avoid recursion/noise.
		if cmd.Name() == "update" || cmd.Name() == "version" {
			return
		}
		go checkForUpdates()
	},
}

func Execute() {
	err := rootCmd.Execute()
	if err != nil {
		os.Exit(1)
	}
}

func init() {
	cobra.OnInitialize(initConfig)

	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is $HOME/.proxyhubb/provider.yaml)")
	rootCmd.PersistentFlags().String("api-url", "http://localhost:8080", "ProxyHub Control API URL")
	rootCmd.PersistentFlags().String("api-key", "", "Provider API Key")

	viper.BindPFlag("api_url", rootCmd.PersistentFlags().Lookup("api-url"))
	viper.BindPFlag("api_key", rootCmd.PersistentFlags().Lookup("api-key"))
}

func initConfig() {
	if cfgFile != "" {
		viper.SetConfigFile(cfgFile)
	} else {
		home, err := os.UserHomeDir()
		cobra.CheckErr(err)

		viper.AddConfigPath(home + "/.proxyhubb")
		viper.AddConfigPath(home)
		viper.SetConfigType("yaml")
		viper.SetConfigName("provider")
	}

	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err == nil {
		fmt.Fprintln(os.Stderr, "Using config file:", viper.ConfigFileUsed())
	}
}

// ============================================
// CONFIG COMMANDS
// ============================================
var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Manage local CLI configuration",
}

var configSetCmd = &cobra.Command{
	Use:   "set [key] [value]",
	Short: "Set a configuration value",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		key, value := args[0], args[1]
		
		// Load existing config or create new
		cfg, err := config.Load("")
		if err != nil {
			cfg = config.DefaultConfig()
		}
		
		// Set the value
		switch key {
		case "api_key":
			cfg.APIKey = value
		case "jwt_token":
			cfg.JWTToken = value
		case "node_id":
			cfg.NodeID = value
		case "gateway_addr":
			cfg.GatewayAddr = value
		case "use_tls":
			cfg.UseTLS = value == "true"
		case "log_level":
			cfg.LogLevel = value
		default:
			// Generic viper set for unknown keys
			viper.Set(key, value)
			if err := viper.WriteConfig(); err != nil {
				return fmt.Errorf("failed to save config: %w", err)
			}
			fmt.Printf("Config updated: %s = %s\n", key, value)
			return nil
		}
		
		// Save config
		if err := cfg.Save(); err != nil {
			return fmt.Errorf("failed to save config: %w", err)
		}
		
		fmt.Printf("Config updated: %s = %s\n", key, value)
		return nil
	},
}

var configGetCmd = &cobra.Command{
	Use:   "get [key]",
	Short: "Get a configuration value",
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		key := args[0]
		value := viper.GetString(key)
		if value == "" {
			fmt.Printf("%s is not set\n", key)
		} else {
			fmt.Printf("%s = %s\n", key, value)
		}
	},
}

var configShowCmd = &cobra.Command{
	Use:   "show",
	Short: "Show all configuration values",
	Run: func(cmd *cobra.Command, args []string) {
		cfg, err := config.Load("")
		if err != nil {
			fmt.Printf("Error loading config: %v\n", err)
			return
		}
		
		fmt.Println("--- Current Configuration ---")
		fmt.Printf("Node ID:        %s\n", cfg.NodeID)
		fmt.Printf("Gateway Addr:   %s\n", cfg.GatewayAddr)
		fmt.Printf("Use TLS:        %v\n", cfg.UseTLS)
		fmt.Printf("TLS Cert Path:  %s\n", cfg.TLSCertPath)
		fmt.Printf("Max Conn:       %d\n", cfg.MaxConnections)
		fmt.Printf("Bandwidth Cap:  %d Mbps\n", cfg.BandwidthLimitMbps)
		fmt.Printf("Log Level:      %s\n", cfg.LogLevel)
		fmt.Printf("Log File:       %s\n", cfg.LogFile)
		fmt.Printf("Metrics:        %v (port %d)\n", cfg.MetricsEnabled, cfg.MetricsPort)
	},
}

var configInitCmd = &cobra.Command{
	Use:   "init",
	Short: "Initialize a new configuration file",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg := config.DefaultConfig()
		
		fmt.Println("--- ProxyHub Provider Configuration ---")
		fmt.Println()
		fmt.Print("Enter API Key: ")
		fmt.Scanln(&cfg.APIKey)
		fmt.Print("Enter JWT Token: ")
		fmt.Scanln(&cfg.JWTToken)
		fmt.Print("Enter Node ID (optional): ")
		fmt.Scanln(&cfg.NodeID)
		
		if err := cfg.Save(); err != nil {
			return fmt.Errorf("failed to save config: %w", err)
		}
		
		configFile, _ := config.GetConfigFile()
		fmt.Printf("\nConfiguration saved to: %s\n", configFile)
		fmt.Println("\nYou can now start your node with: provider-cli node start")
		
		return nil
	},
}

func init() {
	rootCmd.AddCommand(configCmd)
	configCmd.AddCommand(configSetCmd)
	configCmd.AddCommand(configGetCmd)
	configCmd.AddCommand(configShowCmd)
	configCmd.AddCommand(configInitCmd)
}
