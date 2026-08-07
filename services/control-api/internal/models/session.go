package models

import (
	"encoding/base64"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type SessionType string

const (
	SessionRotating  SessionType = "rotating"
	SessionSticky    SessionType = "sticky"
	SessionUniversal SessionType = "universal"
)

type SessionStatus string

const (
	SessionActive            SessionStatus = "active"
	SessionDisabled          SessionStatus = "disabled"
	SessionPendingPayment    SessionStatus = "pending_payment" // Awaiting session escrow fund (Phase 1b)
	SessionActivationPending SessionStatus = "activation_pending"
	SessionActivationFailed  SessionStatus = "activation_failed"
	SessionTerminated        SessionStatus = "terminated"
)

type Session struct {
	ID              uuid.UUID     `gorm:"type:uuid;primary_key" json:"id"`
	UserID          uuid.UUID     `gorm:"type:uuid;not null;index:idx_session_user" json:"user_id"`
	NodeID          *uuid.UUID    `gorm:"type:uuid;index:idx_session_node" json:"node_id"`       // Nullable
	ListingID       *uuid.UUID    `gorm:"type:uuid;index:idx_session_listing" json:"listing_id"` // Link to marketplace listing
	Type            SessionType   `gorm:"type:varchar(50);not null" json:"type"`
	Status          SessionStatus `gorm:"type:varchar(50);default:'active';index:idx_session_status" json:"status"`
	TxHash          string        `gorm:"size:255" json:"tx_hash,omitempty"`
	CredentialsUser string        `gorm:"type:varchar(255)" json:"credentials_user"`
	CredentialsPass string        `gorm:"type:varchar(255)" json:"credentials_pass"`
	Config          string        `gorm:"type:jsonb" json:"config"`
	BandwidthLimit  int64         `gorm:"default:0" json:"bandwidth_limit"` // in bytes, 0 = unlimited
	StartTime       time.Time     `json:"start_time"`
	EndTime         time.Time     `json:"end_time"`
	BytesUsed       int64         `json:"bytes_used"`
	ExpiresAt       *time.Time    `json:"expires_at"`
	CreatedAt       time.Time     `json:"created_at"`
	// N-06: soft-delete — GORM automatically adds WHERE deleted_at IS NULL to all queries.
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`

	// Relations
	Listing *ProxyListing `gorm:"foreignKey:ListingID" json:"listing,omitempty"`

	// Universal Session Fields
	Strategy string  `gorm:"size:50" json:"strategy,omitempty"` // e.g., "fastest", "cheapest", "random"
	MaxPrice float64 `json:"max_price,omitempty"`               // Max price per GB user is willing to pay

	// Social/PAYG fields
	ConversationID   *uuid.UUID `gorm:"type:uuid;index" json:"conversation_id,omitempty"`
	ReviewPrompted   bool       `gorm:"default:false" json:"review_prompted"`
	ReviewPromptedAt *time.Time `json:"review_prompted_at,omitempty"`

	// Phase 1b prepaid session escrow
	SessionPDA     string `gorm:"size:64" json:"session_pda,omitempty"`
	PaymentMethod  string `gorm:"size:50" json:"payment_method,omitempty"` // "solana_session_escrow"
	BuyerWallet    string `gorm:"size:64" json:"buyer_wallet,omitempty"`
	SellerWallet   string `gorm:"size:64" json:"seller_wallet,omitempty"`
	AmountLockedSOL float64 `json:"amount_locked_sol,omitempty"`

	// Preloaded relations
	Conversation *Conversation `gorm:"foreignKey:ConversationID" json:"conversation,omitempty"`
}

func (s *Session) BeforeCreate(tx *gorm.DB) (err error) {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return s.encryptCredentials()
}

func (s *Session) BeforeSave(tx *gorm.DB) error {
	return s.encryptCredentials()
}

func (s *Session) AfterFind(tx *gorm.DB) error {
	return s.decryptCredentials()
}

// CredentialEncryptFn and CredentialDecryptFn are wired from main.go after the
// crypto package is initialised. Using function variables avoids an import cycle
// between models ↔ crypto (crypto imports db which imports models).
// When nil (e.g. in unit tests without crypto setup) encryption is skipped.
var CredentialEncryptFn func(plaintext string) (string, error)
var CredentialDecryptFn func(ciphertext string) (string, error)

// encryptedPrefix marks ciphertext stored in the credentials columns so that
// AfterFind can safely skip fields that were never encrypted (existing rows or
// fields that happen to be empty). Base64-encoded AES-GCM output never starts
// with this prefix naturally because it begins with a base64 character.
const encryptedPrefix = "ENC:"

// encryptCredentials encrypts CredentialsUser and CredentialsPass in-place
// before they are written to the database.
func (s *Session) encryptCredentials() error {
	if CredentialEncryptFn == nil {
		return nil // encryption not configured — skip (dev/test mode)
	}
	var err error
	if s.CredentialsUser != "" && !isEncryptedField(s.CredentialsUser) {
		s.CredentialsUser, err = encryptField(s.CredentialsUser)
		if err != nil {
			return fmt.Errorf("session: failed to encrypt credentials_user: %w", err)
		}
	}
	if s.CredentialsPass != "" && !isEncryptedField(s.CredentialsPass) {
		s.CredentialsPass, err = encryptField(s.CredentialsPass)
		if err != nil {
			return fmt.Errorf("session: failed to encrypt credentials_pass: %w", err)
		}
	}
	return nil
}

// decryptCredentials decrypts CredentialsUser and CredentialsPass in-place
// after they are loaded from the database.
func (s *Session) decryptCredentials() error {
	if CredentialDecryptFn == nil {
		return nil
	}
	var err error
	if isEncryptedField(s.CredentialsUser) {
		s.CredentialsUser, err = decryptField(s.CredentialsUser)
		if err != nil {
			// Log but do not fail the read — partially migrated rows must still be loadable.
			s.CredentialsUser = ""
		}
	}
	if isEncryptedField(s.CredentialsPass) {
		s.CredentialsPass, err = decryptField(s.CredentialsPass)
		if err != nil {
			s.CredentialsPass = ""
		}
	}
	return nil
}

// isEncryptedField returns true when the value carries the ENC: prefix, meaning
// it was written by encryptField and requires decryption on read.
func isEncryptedField(v string) bool {
	return len(v) > len(encryptedPrefix) && v[:len(encryptedPrefix)] == encryptedPrefix
}

func encryptField(plaintext string) (string, error) {
	ciphertext, err := CredentialEncryptFn(plaintext)
	if err != nil {
		return plaintext, err
	}
	return encryptedPrefix + ciphertext, nil
}

func decryptField(value string) (string, error) {
	raw := value[len(encryptedPrefix):]
	// Validate it is valid base64 before passing to decrypt so we can give a
	// clean error for rows that somehow got a malformed value written.
	if _, err := base64.StdEncoding.DecodeString(raw); err != nil {
		return "", fmt.Errorf("session: credentials field is not valid base64: %w", err)
	}
	return CredentialDecryptFn(raw)
}
