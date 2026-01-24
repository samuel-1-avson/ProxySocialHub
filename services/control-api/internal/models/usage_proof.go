package models

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"gorm.io/gorm"
)

// UsageProofStatus represents the state of a usage proof
type UsageProofStatus string

const (
	UsageProofPending              UsageProofStatus = "pending"               // Awaiting signatures
	UsageProofSigned               UsageProofStatus = "signed"                // Both parties signed
	UsageProofSettlingConfidential UsageProofStatus = "settling_confidential" // Being processed by ZK worker
	UsageProofOnChain              UsageProofStatus = "on_chain"              // Submitted to blockchain
	UsageProofDisputed             UsageProofStatus = "disputed"              // One party disputes
)

// UsageProof represents a cryptographically signed usage report
// Both buyer and provider must sign for it to be valid (trustless)
type UsageProof struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	SessionID uuid.UUID `gorm:"type:uuid;not null;index:idx_usage_proof_session" json:"session_id"`
	OrderID   uuid.UUID `gorm:"type:uuid;index:idx_usage_proof_order" json:"order_id"`

	// Parties
	BuyerWallet    string `gorm:"type:varchar(64);not null" json:"buyer_wallet"`
	ProviderWallet string `gorm:"type:varchar(64);not null" json:"provider_wallet"`

	// Usage Data
	BytesUploaded   int64 `gorm:"not null" json:"bytes_uploaded"`
	BytesDownloaded int64 `gorm:"not null" json:"bytes_downloaded"`
	TotalBytes      int64 `gorm:"not null" json:"total_bytes"`
	RequestCount    int64 `gorm:"default:0" json:"request_count"`

	// Time Window
	PeriodStart time.Time `gorm:"not null" json:"period_start"`
	PeriodEnd   time.Time `gorm:"not null" json:"period_end"`

	// Message Hash (what was signed)
	MessageHash string `gorm:"type:varchar(64);not null" json:"message_hash"`

	// Signatures (base58 encoded)
	BuyerSignature    string `gorm:"type:varchar(128)" json:"buyer_signature"`
	ProviderSignature string `gorm:"type:varchar(128)" json:"provider_signature"`

	// Signature Timestamps
	BuyerSignedAt    *time.Time `json:"buyer_signed_at,omitempty"`
	ProviderSignedAt *time.Time `json:"provider_signed_at,omitempty"`

	// On-Chain Reference
	OnChainTxHash string `gorm:"type:varchar(128)" json:"on_chain_tx_hash,omitempty"`
	OnChainSlot   int64  `json:"on_chain_slot,omitempty"`

	// Status
	Status    UsageProofStatus `gorm:"type:varchar(20);default:'pending'" json:"status"`
	CreatedAt time.Time        `json:"created_at"`
	UpdatedAt time.Time        `json:"updated_at"`

	// Relations
	Session *Session `gorm:"foreignKey:SessionID" json:"session,omitempty"`
	Order   *Order   `gorm:"foreignKey:OrderID" json:"order,omitempty"`
}

func (UsageProof) TableName() string {
	return "usage_proofs"
}

func (u *UsageProof) BeforeCreate(tx *gorm.DB) error {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	u.TotalBytes = u.BytesUploaded + u.BytesDownloaded
	return nil
}

// GenerateMessage creates the canonical message to be signed
// Format: SESSION_ID:BUYER:PROVIDER:BYTES:START:END:NONCE
func (u *UsageProof) GenerateMessage() []byte {
	msg := fmt.Sprintf(
		"PROXYHUB_USAGE_PROOF:v1:%s:%s:%s:%d:%d:%d",
		u.SessionID.String(),
		u.BuyerWallet,
		u.ProviderWallet,
		u.TotalBytes,
		u.PeriodStart.Unix(),
		u.PeriodEnd.Unix(),
	)
	return []byte(msg)
}

// ComputeMessageHash computes SHA256 hash of the message
func (u *UsageProof) ComputeMessageHash() string {
	msg := u.GenerateMessage()
	hash := sha256.Sum256(msg)
	return hex.EncodeToString(hash[:])
}

// SetMessageHash computes and sets the message hash
func (u *UsageProof) SetMessageHash() {
	u.MessageHash = u.ComputeMessageHash()
}

// VerifyBuyerSignature verifies the buyer's Ed25519 signature
func (u *UsageProof) VerifyBuyerSignature() (bool, error) {
	if u.BuyerSignature == "" {
		return false, fmt.Errorf("buyer signature not provided")
	}

	pubKeyBytes, err := base58.Decode(u.BuyerWallet)
	if err != nil {
		return false, fmt.Errorf("invalid buyer wallet address: %w", err)
	}

	sigBytes, err := base58.Decode(u.BuyerSignature)
	if err != nil {
		return false, fmt.Errorf("invalid buyer signature encoding: %w", err)
	}

	if len(pubKeyBytes) != ed25519.PublicKeySize {
		return false, fmt.Errorf("invalid public key length")
	}

	if len(sigBytes) != ed25519.SignatureSize {
		return false, fmt.Errorf("invalid signature length")
	}

	msg := u.GenerateMessage()
	return ed25519.Verify(pubKeyBytes, msg, sigBytes), nil
}

// VerifyProviderSignature verifies the provider's Ed25519 signature
func (u *UsageProof) VerifyProviderSignature() (bool, error) {
	if u.ProviderSignature == "" {
		return false, fmt.Errorf("provider signature not provided")
	}

	pubKeyBytes, err := base58.Decode(u.ProviderWallet)
	if err != nil {
		return false, fmt.Errorf("invalid provider wallet address: %w", err)
	}

	sigBytes, err := base58.Decode(u.ProviderSignature)
	if err != nil {
		return false, fmt.Errorf("invalid provider signature encoding: %w", err)
	}

	if len(pubKeyBytes) != ed25519.PublicKeySize {
		return false, fmt.Errorf("invalid public key length")
	}

	if len(sigBytes) != ed25519.SignatureSize {
		return false, fmt.Errorf("invalid signature length")
	}

	msg := u.GenerateMessage()
	return ed25519.Verify(pubKeyBytes, msg, sigBytes), nil
}

// IsFullySigned returns true if both parties have signed
func (u *UsageProof) IsFullySigned() bool {
	return u.BuyerSignature != "" && u.ProviderSignature != ""
}

// VerifyBothSignatures verifies both signatures are valid
func (u *UsageProof) VerifyBothSignatures() (bool, error) {
	buyerValid, err := u.VerifyBuyerSignature()
	if err != nil {
		return false, fmt.Errorf("buyer verification failed: %w", err)
	}
	if !buyerValid {
		return false, fmt.Errorf("buyer signature invalid")
	}

	providerValid, err := u.VerifyProviderSignature()
	if err != nil {
		return false, fmt.Errorf("provider verification failed: %w", err)
	}
	if !providerValid {
		return false, fmt.Errorf("provider signature invalid")
	}

	return true, nil
}

// ToOnChainFormat converts to bytes for on-chain submission
func (u *UsageProof) ToOnChainFormat() []byte {
	data := make([]byte, 0, 256)

	// Session ID (32 bytes)
	sessionBytes, _ := u.SessionID.MarshalBinary()
	data = append(data, sessionBytes...)

	// Total bytes (8 bytes)
	bytesData := make([]byte, 8)
	binary.LittleEndian.PutUint64(bytesData, uint64(u.TotalBytes))
	data = append(data, bytesData...)

	// Period start (8 bytes)
	startData := make([]byte, 8)
	binary.LittleEndian.PutUint64(startData, uint64(u.PeriodStart.Unix()))
	data = append(data, startData...)

	// Period end (8 bytes)
	endData := make([]byte, 8)
	binary.LittleEndian.PutUint64(endData, uint64(u.PeriodEnd.Unix()))
	data = append(data, endData...)

	return data
}

// CreateUsageProofRequest for API binding
type CreateUsageProofRequest struct {
	SessionID       uuid.UUID `json:"session_id" binding:"required"`
	BytesUploaded   int64     `json:"bytes_uploaded" binding:"min=0"`
	BytesDownloaded int64     `json:"bytes_downloaded" binding:"min=0"`
	RequestCount    int64     `json:"request_count"`
	PeriodStart     int64     `json:"period_start" binding:"required"` // Unix timestamp
	PeriodEnd       int64     `json:"period_end" binding:"required"`   // Unix timestamp
}

// SignUsageProofRequest for adding a signature
type SignUsageProofRequest struct {
	ProofID   uuid.UUID `json:"proof_id" binding:"required"`
	Signature string    `json:"signature" binding:"required"` // Base58 encoded
}

// UsageProofResponse for API responses
type UsageProofResponse struct {
	UsageProof
	MessageToSign    string `json:"message_to_sign,omitempty"`
	BuyerVerified    bool   `json:"buyer_verified"`
	ProviderVerified bool   `json:"provider_verified"`
}
