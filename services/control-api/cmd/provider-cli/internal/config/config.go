// Package config provides configuration management for the provider CLI.
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/viper"
)

// Config holds all configuration for the provider CLI.
type Config struct {
	// Node identification
	NodeID        string `mapstructure:"node_id"`
	JWTToken      string `mapstructure:"jwt_token"`
	APIKey        string `mapstructure:"api_key"`
	WalletAddress string `mapstructure:"wallet_address"` // Solana address for payouts

	// Gateway connection
	GatewayAddr       string        `mapstructure:"gateway_addr"`
	UseTLS            bool          `mapstructure:"use_tls"`
	TLSCertPath       string        `mapstructure:"tls_cert_path"`
	TLSSkipVerify     bool          `mapstructure:"tls_skip_verify"`
	ConnectTimeout    time.Duration `mapstructure:"connect_timeout"`
	ReconnectInterval time.Duration `mapstructure:"reconnect_interval"`

	// Performance tuning
	MaxConnections    uint32 `mapstructure:"max_connections"`
	BandwidthLimitMbps uint32 `mapstructure:"bandwidth_limit_mbps"`

	// Features
	AllowedPorts []uint16 `mapstructure:"allowed_ports"`
	BlockedHosts []string `mapstructure:"blocked_hosts"`

	// Logging
	LogLevel string `mapstructure:"log_level"`
	LogFile  string `mapstructure:"log_file"`

	// Metrics
	MetricsEnabled bool   `mapstructure:"metrics_enabled"`
	MetricsPort    int    `mapstructure:"metrics_port"`
	MetricsPath    string `mapstructure:"metrics_path"`

	// Auto-start
	AutoStart bool `mapstructure:"auto_start"`
}

// DefaultConfig returns the default configuration.
func DefaultConfig() *Config {
	return &Config{
		GatewayAddr:        "localhost:4000",
		UseTLS:             true,
		ConnectTimeout:     10 * time.Second,
		ReconnectInterval:  30 * time.Second,
		MaxConnections:     100,
		BandwidthLimitMbps: 100,
		AllowedPorts:       []uint16{80, 443, 8080, 8443},
		LogLevel:           "info",
		MetricsEnabled:     true,
		MetricsPort:        9090,
		MetricsPath:        "/metrics",
	}
}

// Load loads configuration from file and environment variables.
func Load(configPath string) (*Config, error) {
	cfg := DefaultConfig()

	// Set config name and paths
	if configPath != "" {
		viper.SetConfigFile(configPath)
	} else {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("failed to get home directory: %w", err)
		}
		viper.AddConfigPath(filepath.Join(home, ".proxyhubb"))
		viper.AddConfigPath(home)
		viper.SetConfigName("provider")
		viper.SetConfigType("yaml")
	}

	// Set environment variable prefix
	viper.SetEnvPrefix("PROXYHUB")
	viper.AutomaticEnv()

	// Read config file (optional)
	if err := viper.ReadInConfig(); err != nil {
		// Config file not found is okay
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("failed to read config: %w", err)
		}
	}

	// Unmarshal into struct
	if err := viper.Unmarshal(cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	// Validate required fields
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

// Validate checks if the configuration is valid.
func (c *Config) Validate() error {
	if c.JWTToken == "" && c.APIKey == "" {
		return fmt.Errorf("either jwt_token or api_key must be provided")
	}

	if c.GatewayAddr == "" {
		return fmt.Errorf("gateway_addr cannot be empty")
	}

	if c.MaxConnections == 0 {
		return fmt.Errorf("max_connections must be greater than 0")
	}

	if c.ConnectTimeout < 1*time.Second {
		return fmt.Errorf("connect_timeout must be at least 1 second")
	}

	return nil
}

// Save saves the configuration to the default location.
func (c *Config) Save() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}

	configDir := filepath.Join(home, ".proxyhubb")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	configFile := filepath.Join(configDir, "provider.yaml")

	// Convert to map for viper
	viper.Set("node_id", c.NodeID)
	viper.Set("jwt_token", c.JWTToken)
	viper.Set("api_key", c.APIKey)
	viper.Set("wallet_address", c.WalletAddress)
	viper.Set("gateway_addr", c.GatewayAddr)
	viper.Set("use_tls", c.UseTLS)
	viper.Set("tls_cert_path", c.TLSCertPath)
	viper.Set("max_connections", c.MaxConnections)
	viper.Set("bandwidth_limit_mbps", c.BandwidthLimitMbps)
	viper.Set("log_level", c.LogLevel)

	if err := viper.WriteConfigAs(configFile); err != nil {
		return fmt.Errorf("failed to write config: %w", err)
	}

	return nil
}

// GetConfigFile returns the path to the config file.
func GetConfigFile() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".proxyhubb", "provider.yaml"), nil
}
