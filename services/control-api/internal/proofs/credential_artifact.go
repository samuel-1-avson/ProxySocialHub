package proofs

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	// OrderCredentialMessageType identifies Wave 3.3 buyer credential artifacts.
	OrderCredentialMessageType = "PROXYHUB_ORDER_CREDENTIAL_V1"
	OrderCredentialVersion     = "1"
)

// OrderCredentialPayload is the canonical fields hashed for a credential proof.
// Password is intentionally excluded — only a username commitment is bound.
type OrderCredentialPayload struct {
	OrderID      uuid.UUID
	SessionID    uuid.UUID
	BuyerID      uuid.UUID
	ListingID    uuid.UUID
	UsernameHash string // sha256 hex of plaintext credentials_user
	IssuedAt     int64
	ExpiresAt    int64
}

// OrderCredentialArtifact is the observe-mode verifiable wrapper returned to buyers.
type OrderCredentialArtifact struct {
	MessageType string `json:"message_type"`
	Version     string `json:"version"`
	OrderID     string `json:"order_id"`
	SessionID   string `json:"session_id"`
	BuyerID     string `json:"buyer_id"`
	ListingID   string `json:"listing_id"`
	UsernameHash string `json:"username_hash"`
	IssuedAt    int64  `json:"issued_at"`
	ExpiresAt   int64  `json:"expires_at"`
	PayloadHash string `json:"payload_hash"`
	Signature   string `json:"signature"`
	SignerKind  string `json:"signer_kind"` // hmac_session_secret | none
	Mode        string `json:"mode"`        // observe
}

// HashOrderCredentialPayload returns sha256 hex of the canonical pipe-joined payload.
func HashOrderCredentialPayload(p OrderCredentialPayload) string {
	canonical := strings.Join([]string{
		OrderCredentialMessageType,
		OrderCredentialVersion,
		p.OrderID.String(),
		p.SessionID.String(),
		p.BuyerID.String(),
		p.ListingID.String(),
		strings.TrimSpace(p.UsernameHash),
		fmt.Sprintf("%d", p.IssuedAt),
		fmt.Sprintf("%d", p.ExpiresAt),
	}, "|")
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:])
}

// HashCredentialsUsername mirrors sessioncache username commitment (sha256 hex).
func HashCredentialsUsername(username string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(username)))
	return hex.EncodeToString(sum[:])
}

// BuildOrderCredentialArtifact creates an observe-mode HMAC artifact.
// Uses SESSION_SECRET (fallback GATEWAY_SHARED_SECRET). Returns nil when secret missing.
func BuildOrderCredentialArtifact(p OrderCredentialPayload, mode string) *OrderCredentialArtifact {
	if p.OrderID == uuid.Nil || p.SessionID == uuid.Nil {
		return nil
	}
	if p.IssuedAt <= 0 {
		p.IssuedAt = time.Now().UTC().Unix()
	}
	if p.ExpiresAt <= 0 {
		p.ExpiresAt = p.IssuedAt + 24*3600
	}
	if strings.TrimSpace(p.UsernameHash) == "" {
		return nil
	}
	secret := strings.TrimSpace(os.Getenv("SESSION_SECRET"))
	if secret == "" {
		secret = strings.TrimSpace(os.Getenv("GATEWAY_SHARED_SECRET"))
	}
	payloadHash := HashOrderCredentialPayload(p)
	art := &OrderCredentialArtifact{
		MessageType:  OrderCredentialMessageType,
		Version:      OrderCredentialVersion,
		OrderID:      p.OrderID.String(),
		SessionID:    p.SessionID.String(),
		BuyerID:      p.BuyerID.String(),
		ListingID:    p.ListingID.String(),
		UsernameHash: p.UsernameHash,
		IssuedAt:     p.IssuedAt,
		ExpiresAt:    p.ExpiresAt,
		PayloadHash:  payloadHash,
		Mode:         mode,
		SignerKind:   "none",
	}
	if secret == "" {
		return art
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payloadHash))
	art.Signature = hex.EncodeToString(mac.Sum(nil))
	art.SignerKind = "hmac_session_secret"
	return art
}

// VerifyOrderCredentialHMAC checks observe-mode HMAC (tests / future enforce).
func VerifyOrderCredentialHMAC(art *OrderCredentialArtifact, secret string) bool {
	if art == nil || strings.TrimSpace(art.Signature) == "" || strings.TrimSpace(secret) == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(art.PayloadHash))
	want := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(want), []byte(art.Signature))
}
