// internal/config/secure.go
// Secure configuration loading with validation
// No default secrets - fails fast if required secrets are missing

package config

import (
	"context"
	"fmt"
	"os"
	"strings"
)

// RequiredSecrets lists all secrets that must be present
var RequiredSecrets = []string{
	"DATABASE_URL",
	"JWT_SECRET",
	"SESSION_SECRET",
	"ENCRYPTION_KEY",
	"REDIS_PASSWORD",
}

// SecretLoader interface for loading secrets from various sources
type SecretLoader interface {
	Load(ctx context.Context, key string) (string, error)
	LoadRequired(ctx context.Context, key string) (string, error)
}

// EnvLoader loads secrets from environment variables
type EnvLoader struct {
	validated bool
}

// NewEnvLoader creates a new environment loader
func NewEnvLoader() *EnvLoader {
	return &EnvLoader{}
}

// Load gets a secret from environment
func (e *EnvLoader) Load(ctx context.Context, key string) (string, error) {
	value := os.Getenv(key)
	return value, nil
}

// LoadRequired gets a required secret, returns error if missing
func (e *EnvLoader) LoadRequired(ctx context.Context, key string) (string, error) {
	value := os.Getenv(key)
	if value == "" {
		return "", fmt.Errorf("required secret %s is not set", key)
	}
	return value, nil
}

// Validate ensures all required secrets are present
func (e *EnvLoader) Validate() error {
	var missing []string
	for _, secret := range RequiredSecrets {
		if os.Getenv(secret) == "" {
			missing = append(missing, secret)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required secrets: %v\n\nGenerate secrets with:\n  JWT_SECRET: openssl rand -hex 64\n  SESSION_SECRET: openssl rand -hex 64\n  ENCRYPTION_KEY: openssl rand -base64 32", missing)
	}
	e.validated = true
	return nil
}

// SecureConfig holds the secure configuration
type SecureConfig struct {
	Server   ServerConfig
	Database DatabaseConfig
	Auth     AuthConfig
	Redis    RedisConfig
	Secrets  SecretsConfig
}

// SecretsConfig holds secret-related config
type SecretsConfig struct {
	EncryptionKey string
	JWTSecret     string
	SessionSecret string
}

// RedisConfig holds Redis configuration
type RedisConfig struct {
	URL      string
	Password string
}

// LoadSecure loads configuration securely
func LoadSecure() (*SecureConfig, error) {
	loader := NewEnvLoader()
	
	// Validate all required secrets are present
	if err := loader.Validate(); err != nil {
		return nil, err
	}
	
	ctx := context.Background()
	
	cfg := &SecureConfig{}
	
	// Server config (with safe defaults for non-sensitive values)
	cfg.Server.Port = getEnvOrDefault("PORT", "8080")
	cfg.Server.APIBaseURL = getEnvOrDefault("API_BASE_URL", "http://localhost:8080")
	cfg.Server.FrontendURL = getEnvOrDefault("FRONTEND_URL", "http://localhost:3000")
	cfg.Server.Environment = getEnvOrDefault("GO_ENV", "development")
	
	// Parse CORS origins
	corsOrigins := getEnvOrDefault("CORS_ORIGINS", "")
	if corsOrigins != "" {
		cfg.Server.CORSOrigins = strings.Split(corsOrigins, ",")
		for i := range cfg.Server.CORSOrigins {
			cfg.Server.CORSOrigins[i] = strings.TrimSpace(cfg.Server.CORSOrigins[i])
		}
	}
	
	// Required secrets - fail if missing
	databaseURL, err := loader.LoadRequired(ctx, "DATABASE_URL")
	if err != nil {
		return nil, err
	}
	cfg.Database.DatabaseURL = databaseURL
	
	// JWT Secret validation
	jwtSecret, err := loader.LoadRequired(ctx, "JWT_SECRET")
	if err != nil {
		return nil, err
	}
	// Validate JWT secret strength (minimum 64 chars for HS256)
	if len(jwtSecret) < 64 {
		return nil, fmt.Errorf("JWT_SECRET must be at least 64 characters for security (got %d)", len(jwtSecret))
	}
	cfg.Secrets.JWTSecret = jwtSecret
	// Note: cfg.Auth.JWTSecret is set via the existing AuthConfig
	
	// Session Secret
	sessionSecret, err := loader.LoadRequired(ctx, "SESSION_SECRET")
	if err != nil {
		return nil, err
	}
	if len(sessionSecret) < 32 {
		return nil, fmt.Errorf("SESSION_SECRET must be at least 32 characters (got %d)", len(sessionSecret))
	}
	cfg.Secrets.SessionSecret = sessionSecret
	// SessionSecret is stored in SecretsConfig only
	
	// Encryption Key
	encryptionKey, err := loader.LoadRequired(ctx, "ENCRYPTION_KEY")
	if err != nil {
		return nil, err
	}
	// Validate encryption key (should be base64 encoded 32 bytes = 44 chars)
	if len(encryptionKey) < 32 {
		return nil, fmt.Errorf("ENCRYPTION_KEY must be at least 32 characters (got %d)", len(encryptionKey))
	}
	cfg.Secrets.EncryptionKey = encryptionKey
	
	// Redis
	redisPassword, err := loader.LoadRequired(ctx, "REDIS_PASSWORD")
	if err != nil {
		return nil, err
	}
	cfg.Redis.Password = redisPassword
	
	// Build Redis URL with authentication
	redisHost := getEnvOrDefault("REDIS_HOST", "localhost")
	redisPort := getEnvOrDefault("REDIS_PORT", "6379")
	cfg.Redis.URL = fmt.Sprintf("redis://:%s@%s:%s", redisPassword, redisHost, redisPort)
	cfg.Database.RedisURL = cfg.Redis.URL
	
	return cfg, nil
}

// ValidateJWTSecret checks if JWT secret meets security requirements
func ValidateJWTSecret(secret string) error {
	if len(secret) < 64 {
		return fmt.Errorf("JWT secret too short: %d chars (minimum 64)", len(secret))
	}
	
	// Check for common weak patterns
	weakPatterns := []string{
		"secret",
		"password",
		"123456",
		"default",
		"change",
		"dev",
		"test",
		"proxyhubb",
	}
	
	lowerSecret := strings.ToLower(secret)
	for _, pattern := range weakPatterns {
		if strings.Contains(lowerSecret, pattern) {
			return fmt.Errorf("JWT secret contains weak pattern: %s", pattern)
		}
	}
	
	return nil
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
