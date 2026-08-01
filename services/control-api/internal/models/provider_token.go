package models

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// TokenHashFn is the function used to hash raw provider tokens before storage.
// It is wired in main.go to an HMAC-SHA256 implementation keyed by TOKEN_HMAC_SECRET.
// This avoids an import cycle between models ↔ crypto.
var TokenHashFn func(rawToken string) string

// ProviderToken represents an access token for the Provider CLI
type ProviderToken struct {
	ID        uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID    uuid.UUID      `gorm:"type:uuid;index;not null" json:"user_id"`
	Token     string         `gorm:"type:varchar(64);uniqueIndex;not null" json:"-"` // Hashed token, never return raw
	Name      string         `gorm:"type:varchar(100)" json:"name"`                  // Optional name for the token
	LastUsed  time.Time      `json:"last_used"`
	ExpiresAt *time.Time     `json:"expires_at,omitempty"` // Optional expiration
	IsActive  bool           `gorm:"default:true" json:"is_active"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

// TableName specifies the table name
func (ProviderToken) TableName() string {
	return "provider_tokens"
}

// BeforeCreate hook
func (pt *ProviderToken) BeforeCreate(tx *gorm.DB) (err error) {
	if pt.ID == uuid.Nil {
		pt.ID = uuid.New()
	}
	return
}

// GenerateRawToken generates a new random token string
// This should be called before hashing and storing
func GenerateRawToken() (string, error) {
	bytes := make([]byte, 32) // 256 bits
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// HashToken hashes a raw provider token for storage using the wired TokenHashFn.
// TokenHashFn must be set in main.go before any tokens are created or validated.
// Panics if TokenHashFn is nil to catch misconfiguration at startup.
func HashToken(rawToken string) string {
	if TokenHashFn == nil {
		panic("models.TokenHashFn is not set — wire it in main.go before use")
	}
	return TokenHashFn(rawToken)
}

// MaskToken returns a masked version for display
func (pt *ProviderToken) MaskToken() string {
	if len(pt.Token) < 12 {
		return "****"
	}
	return pt.Token[:4] + "****" + pt.Token[len(pt.Token)-4:]
}

// CLIDownload represents a CLI binary download
type CLIDownload struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Version     string    `gorm:"type:varchar(20);not null" json:"version"`
	Platform    string    `gorm:"type:varchar(20);not null" json:"platform"`                   // windows, macos, linux
	Arch        string    `gorm:"type:varchar(20);not null" json:"arch"`                       // amd64, arm64
	PackageType string    `gorm:"type:varchar(20);default:'daemon';index" json:"package_type"` // daemon, wrapper, bundle
	Filename    string    `gorm:"type:varchar(255);not null" json:"filename"`
	FilePath    string    `gorm:"type:varchar(500);not null" json:"-"` // Internal path, not exposed
	FileSize    int64     `json:"file_size"`
	Checksum    string    `gorm:"type:varchar(128)" json:"checksum"` // SHA256 hex (64 chars; room for prefix)
	DownloadURL string    `gorm:"type:varchar(500)" json:"download_url"`
	IsLatest    bool      `gorm:"default:false;index" json:"is_latest"`
	IsActive    bool      `gorm:"default:true" json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// TableName specifies the table name
func (CLIDownload) TableName() string {
	return "cli_downloads"
}

// GetPlatformDisplayName returns human-readable platform name
func (c CLIDownload) GetPlatformDisplayName() string {
	switch c.Platform {
	case "windows":
		return "Windows"
	case "macos", "darwin":
		return "macOS"
	case "linux":
		return "Linux"
	default:
		return c.Platform
	}
}

// GetArchDisplayName returns human-readable architecture name
func (c CLIDownload) GetArchDisplayName() string {
	switch c.Arch {
	case "amd64", "x64":
		return "x64"
	case "arm64":
		return "ARM64"
	default:
		return c.Arch
	}
}

// ProviderNodeRegistration tracks nodes registered via CLI
type ProviderNodeRegistration struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID     uuid.UUID `gorm:"type:uuid;index;not null" json:"user_id"`
	TokenID    uuid.UUID `gorm:"type:uuid;index;not null" json:"token_id"` // Token used to register
	NodeID     uuid.UUID `gorm:"type:uuid;index;not null" json:"node_id"`  // Reference to nodes table
	IPAddress  string    `gorm:"type:varchar(45)" json:"ip_address"`
	Hostname   string    `gorm:"type:varchar(100)" json:"hostname"`
	CLIVersion string    `gorm:"type:varchar(20)" json:"cli_version"`
	FirstSeen  time.Time `json:"first_seen"`
	LastSeen   time.Time `json:"last_seen"`
	IsActive   bool      `gorm:"default:true" json:"is_active"`
}

// TableName specifies the table name
func (ProviderNodeRegistration) TableName() string {
	return "provider_node_registrations"
}
