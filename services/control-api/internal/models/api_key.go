package models

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// APIKeyPermission represents allowed permissions for an API key
type APIKeyPermission string

const (
	PermissionRead  APIKeyPermission = "read"  // Read-only access to data
	PermissionWrite APIKeyPermission = "write" // Write access to data
	PermissionProxy APIKeyPermission = "proxy" // Use proxy services
	PermissionAdmin APIKeyPermission = "admin" // Admin-level access
)

// PermissionsList is a custom type for storing permissions as JSON
type PermissionsList []string

// Scan implements sql.Scanner
func (p *PermissionsList) Scan(value interface{}) error {
	if value == nil {
		*p = nil
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		if str, ok := value.(string); ok {
			bytes = []byte(str)
		}
	}
	return json.Unmarshal(bytes, p)
}

// Value implements driver.Valuer
func (p PermissionsList) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return json.Marshal(p)
}

// APIKey represents a user's API key for programmatic access
type APIKey struct {
	ID              uuid.UUID       `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID          uuid.UUID       `gorm:"type:uuid;not null" json:"user_id"`
	Name            string          `gorm:"size:100;not null" json:"name"`
	KeyHash         string          `gorm:"size:64;not null" json:"-"` // Never expose hash
	KeyPrefix       string          `gorm:"size:12;not null" json:"key_prefix"`
	Permissions     PermissionsList `gorm:"type:jsonb" json:"permissions"`
	RateLimitPerMin int             `gorm:"column:rate_limit_per_minute;default:100" json:"rate_limit_per_minute"`
	LastUsedAt      *time.Time      `json:"last_used_at,omitempty"`
	ExpiresAt       *time.Time      `json:"expires_at,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	RevokedAt       *time.Time      `json:"revoked_at,omitempty"`
}

// TableName specifies the table name for GORM
func (APIKey) TableName() string {
	return "api_keys"
}

// APIKeyResponse is returned when creating a new API key (includes the full key once)
type APIKeyResponse struct {
	ID              uuid.UUID  `json:"id"`
	Name            string     `json:"name"`
	Key             string     `json:"key,omitempty"` // Only shown once on creation
	KeyPrefix       string     `json:"key_prefix"`
	Permissions     []string   `json:"permissions"`
	RateLimitPerMin int        `json:"rate_limit_per_minute"`
	ExpiresAt       *time.Time `json:"expires_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

// GenerateAPIKey creates a new API key with a random secret
// Returns the APIKey model and the plaintext key (only shown once)
func GenerateAPIKey(userID uuid.UUID, name string, permissions []string, rateLimitPerMin int, expiresAt *time.Time) (*APIKey, string, error) {
	// Generate 32-byte random key
	keyBytes := make([]byte, 32)
	if _, err := rand.Read(keyBytes); err != nil {
		return nil, "", err
	}

	// Create the API key string: pk_<hex>
	plaintextKey := "pk_" + hex.EncodeToString(keyBytes)

	// Hash the key for storage
	hash := sha256.Sum256([]byte(plaintextKey))
	keyHash := hex.EncodeToString(hash[:])

	// Get prefix for display (pk_ + first 8 hex chars)
	keyPrefix := plaintextKey[:12]

	// Set default permissions if none provided
	if len(permissions) == 0 {
		permissions = []string{string(PermissionRead), string(PermissionProxy)}
	}

	// Set default rate limit if not specified
	if rateLimitPerMin <= 0 {
		rateLimitPerMin = 100
	}

	apiKey := &APIKey{
		UserID:          userID,
		Name:            name,
		KeyHash:         keyHash,
		KeyPrefix:       keyPrefix,
		Permissions:     permissions,
		RateLimitPerMin: rateLimitPerMin,
		ExpiresAt:       expiresAt,
	}

	return apiKey, plaintextKey, nil
}

// HashAPIKey hashes an API key for comparison
func HashAPIKey(plaintextKey string) string {
	hash := sha256.Sum256([]byte(plaintextKey))
	return hex.EncodeToString(hash[:])
}

// IsActive returns true if the key is not revoked and not expired
func (k *APIKey) IsActive() bool {
	if k.RevokedAt != nil {
		return false
	}
	if k.ExpiresAt != nil && time.Now().After(*k.ExpiresAt) {
		return false
	}
	return true
}

// HasPermission checks if the key has the specified permission
func (k *APIKey) HasPermission(perm APIKeyPermission) bool {
	for _, p := range k.Permissions {
		if APIKeyPermission(p) == perm || APIKeyPermission(p) == PermissionAdmin {
			return true
		}
	}
	return false
}

// Revoke marks the API key as revoked
func (k *APIKey) Revoke() {
	now := time.Now()
	k.RevokedAt = &now
}

// UpdateLastUsed updates the last used timestamp
func (k *APIKey) UpdateLastUsed() {
	now := time.Now()
	k.LastUsedAt = &now
}

// ToResponse converts the APIKey to a response format
func (k *APIKey) ToResponse() APIKeyResponse {
	return APIKeyResponse{
		ID:              k.ID,
		Name:            k.Name,
		KeyPrefix:       k.KeyPrefix,
		Permissions:     k.Permissions,
		RateLimitPerMin: k.RateLimitPerMin,
		ExpiresAt:       k.ExpiresAt,
		CreatedAt:       k.CreatedAt,
	}
}

// ToResponseWithKey returns response including the plaintext key (for creation only)
func (k *APIKey) ToResponseWithKey(plaintextKey string) APIKeyResponse {
	resp := k.ToResponse()
	resp.Key = plaintextKey
	return resp
}
