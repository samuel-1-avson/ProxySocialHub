package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	Auth     AuthConfig
	OAuth    OAuthConfig
	Email    EmailConfig
	Payments PaymentsConfig
	Crypto   CryptoConfig

	Blockchain BlockchainConfig
	Gateway    GatewayConfig
	Admin      AdminConfig
}

// AdminConfig keeps legacy admin auth settings. Admin API routes are disabled,
// so these values are optional and retained only for backward compatibility.
type AdminConfig struct {
	JWTSecret    string
	SessionTTLHr int
	Accounts     []AdminAccount
}

type AdminAccount struct {
	Username   string
	Password   string // plaintext from env var; compared with constant-time compare
	Role       string // superadmin | sysops | support
	TOTPSecret string // base32-encoded TOTP secret; if set, MFA is required at login
}

type GatewayConfig struct {
	ManagementURL string
}

type ServerConfig struct {
	Port        string
	APIBaseURL  string
	FrontendURL string
	CORSOrigins []string
	Environment string
}

type DatabaseConfig struct {
	DatabaseURL string
	RedisURL    string
}

type AuthConfig struct {
	JWTSecret string
}

type OAuthConfig struct {
	GoogleClientID     string
	GoogleClientSecret string
	GithubClientID     string
	GithubClientSecret string
}

type EmailConfig struct {
	SMTPHost  string
	SMTPPort  string
	SMTPUser  string
	SMTPPass  string
	FromEmail string
	FromName  string
	AppURL    string
	Enabled   bool
}

type PaymentsConfig struct {
	MTNBaseURL         string
	MTNSubscriptionKey string
	MTNAPIUser         string
	MTNAPIKey          string
	MTNEnvironment     string
	CallbackURL        string
}

type CryptoConfig struct {
	OraclePrivateKey string
}

type BlockchainConfig struct {
	EthRPC          string
	RegistryAddress string
	PHBTokenMint    string // SPL token mint address for the PHB governance/fee token
}

// Load loads configuration from environment variables
func Load() (*Config, error) {
	cfg := &Config{}

	// Server
	cfg.Server.Port = getEnv("PORT", "8080")
	cfg.Server.APIBaseURL = getEnv("API_BASE_URL", "http://localhost:8080")
	cfg.Server.FrontendURL = getEnv("FRONTEND_URL", "http://localhost:3000")
	cfg.Server.Environment = getEnv("GO_ENV", "development")

	cors := getEnv("CORS_ORIGINS", "")
	if cors != "" {
		origins := strings.Split(cors, ",")
		for i := range origins {
			origins[i] = strings.TrimSpace(origins[i])
		}
		cfg.Server.CORSOrigins = origins
	} else {
		cfg.Server.CORSOrigins = []string{
			"http://localhost:3000",
			"http://localhost:3001",
			"http://127.0.0.1:3000",
			"http://localhost:4001",
			"https://proxy-social-hub.vercel.app", // Allow Vercel Frontend
		}
	}

	// Database
	cfg.Database.DatabaseURL = os.Getenv("DATABASE_URL")
	if cfg.Database.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	cfg.Database.RedisURL = getEnv("REDIS_URL", "redis://localhost:6379")

	// Auth
	cfg.Auth.JWTSecret = getEnv("JWT_SECRET", "proxyhubb-dev-secret-change-in-production")

	// OAuth
	cfg.OAuth.GoogleClientID = os.Getenv("GOOGLE_CLIENT_ID")
	cfg.OAuth.GoogleClientSecret = os.Getenv("GOOGLE_CLIENT_SECRET")
	cfg.OAuth.GithubClientID = os.Getenv("GITHUB_CLIENT_ID")
	cfg.OAuth.GithubClientSecret = os.Getenv("GITHUB_CLIENT_SECRET")

	// Email
	cfg.Email.SMTPHost = os.Getenv("SMTP_HOST")
	cfg.Email.SMTPPort = getEnv("SMTP_PORT", "587")
	cfg.Email.SMTPUser = os.Getenv("SMTP_USER")
	cfg.Email.SMTPPass = os.Getenv("SMTP_PASS")
	cfg.Email.FromEmail = os.Getenv("FROM_EMAIL")
	cfg.Email.FromName = getEnv("FROM_NAME", "ProxyHubb")
	cfg.Email.AppURL = getEnv("APP_URL", "http://localhost:3000")
	cfg.Email.Enabled = cfg.Email.SMTPHost != ""

	// Payments
	cfg.Payments.MTNBaseURL = getEnv("MTN_MOMO_BASE_URL", "https://sandbox.momodeveloper.mtn.com")
	cfg.Payments.MTNSubscriptionKey = os.Getenv("MTN_MOMO_SUBSCRIPTION_KEY")
	cfg.Payments.MTNAPIUser = os.Getenv("MTN_MOMO_API_USER")
	cfg.Payments.MTNAPIKey = os.Getenv("MTN_MOMO_API_KEY")
	cfg.Payments.MTNEnvironment = getEnv("MTN_MOMO_ENVIRONMENT", "sandbox")
	cfg.Payments.CallbackURL = os.Getenv("MOMO_CALLBACK_URL")

	// Crypto
	cfg.Crypto.OraclePrivateKey = os.Getenv("ORACLE_PRIVATE_KEY")

	// Blockchain
	cfg.Blockchain.EthRPC = getEnv("ETH_RPC_URL", "http://localhost:8545")
	cfg.Blockchain.RegistryAddress = os.Getenv("REGISTRY_CONTRACT_ADDRESS")
	cfg.Blockchain.PHBTokenMint = os.Getenv("PHB_TOKEN_MINT")

	// Edge Gateway
	cfg.Gateway.ManagementURL = getEnv("EDGE_GATEWAY_MGMT_URL", "http://edge-gateway:8090")

	// Legacy Admin Config (optional)
	cfg.Admin.JWTSecret = strings.TrimSpace(os.Getenv("ADMIN_JWT_SECRET"))
	cfg.Admin.SessionTTLHr = 4

	addAdminAccount := func(usernameEnv, passwordEnv, roleEnv, defaultRole, totpEnv string) {
		username := strings.TrimSpace(os.Getenv(usernameEnv))
		password := strings.TrimSpace(os.Getenv(passwordEnv))
		if username == "" || password == "" {
			return
		}
		cfg.Admin.Accounts = append(cfg.Admin.Accounts, AdminAccount{
			Username:   username,
			Password:   password,
			Role:       getEnv(roleEnv, defaultRole),
			TOTPSecret: getEnv(totpEnv, ""),
		})
	}

	addAdminAccount("ADMIN_ACCOUNT_1_USERNAME", "ADMIN_ACCOUNT_1_PASSWORD", "ADMIN_ACCOUNT_1_ROLE", "superadmin", "ADMIN_ACCOUNT_1_TOTP_SECRET")
	addAdminAccount("ADMIN_ACCOUNT_2_USERNAME", "ADMIN_ACCOUNT_2_PASSWORD", "ADMIN_ACCOUNT_2_ROLE", "sysops", "ADMIN_ACCOUNT_2_TOTP_SECRET")
	addAdminAccount("ADMIN_ACCOUNT_3_USERNAME", "ADMIN_ACCOUNT_3_PASSWORD", "ADMIN_ACCOUNT_3_ROLE", "support", "ADMIN_ACCOUNT_3_TOTP_SECRET")

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func requireEnv(key string) (string, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return "", fmt.Errorf("%s is required", key)
	}
	return value, nil
}
