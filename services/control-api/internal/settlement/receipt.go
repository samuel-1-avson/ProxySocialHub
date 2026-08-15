package settlement

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/proofs"
)

const (
	ReceiptMessageType = "PROXYHUB_SETTLEMENT_RECEIPT"
	ReceiptVersion     = "1"
	receiptPrefix      = "PROXYHUB_SETTLEMENT_RECEIPT:v1:"
)

// PortableReceipt is a signed settlement window copy. Not trustless metering.
type PortableReceipt struct {
	MessageType  string `json:"message_type"`
	Version      string `json:"version"`
	WindowKey    string `json:"window_key"`
	SessionID    string `json:"session_id"`
	UserRef      string `json:"user_ref,omitempty"`
	ProviderRef  string `json:"provider_ref,omitempty"`
	ReceiptCount int    `json:"receipt_count"`
	TotalBytes   int64  `json:"total_bytes"`
	Status       string `json:"status"`
	EscrowTx     string `json:"escrow_tx,omitempty"`
	IssuedAt     int64  `json:"issued_at"`
	IssuerPubkey string `json:"issuer_pubkey,omitempty"`
	Signature    string `json:"signature"`
	Note         string `json:"note"`
}

// BundleConfigured is true when a non-Postgres reconstruct pin is set.
func BundleConfigured() bool {
	return strings.TrimSpace(os.Getenv("PROXYHUB_SETTLEMENT_BUNDLE_PATH")) != "" ||
		strings.TrimSpace(os.Getenv("PROXYHUB_SETTLEMENT_BUNDLE_URL")) != "" ||
		strings.TrimSpace(os.Getenv("PROXYHUB_SETTLEMENT_BUNDLE_CID")) != ""
}

// ReceiptSoT is postgres | postgres_cache | escrow_pda.
func ReceiptSoT(escrowTx string) string {
	if strings.TrimSpace(escrowTx) != "" {
		return "escrow_pda"
	}
	if BundleConfigured() {
		return "postgres_cache"
	}
	return "postgres"
}

func slashEnvTruthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// ExecuteMode is public honesty. This slice never broadcasts SOL.
func ExecuteMode() string {
	armed := slashEnvTruthy(os.Getenv("PROXYHUB_SETTLEMENT_BUNDLE_AUTO")) &&
		os.Getenv("PROXYHUB_SETTLEMENT_BUNDLE_CONFIRM") == "1"
	if armed {
		return "gates_armed_observe_only"
	}
	return "off"
}

// WouldBroadcast is always false — Wave 9.C is reconstruct/verify, not a treasury.
func WouldBroadcast() bool { return false }

// SigningKey is PROXYHUB_SETTLEMENT_BUNDLE_SIGNING_KEY.
func SigningKey() string {
	return strings.TrimSpace(os.Getenv("PROXYHUB_SETTLEMENT_BUNDLE_SIGNING_KEY"))
}

// GenerateSigningSecret returns a fresh base58 Ed25519 seed (not persisted).
func GenerateSigningSecret() (string, error) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", err
	}
	return base58.Encode(priv.Seed()), nil
}

// SampleManifest is a reconstruct fixture (no orders table).
func SampleManifest() models.SettlementManifest {
	return models.SettlementManifest{
		WindowKey:    "w9d-window-1",
		SessionID:    uuid.MustParse("12345678-1234-1234-1234-123456789abc"),
		UserRef:      "buyer",
		ProviderRef:  "seller",
		ReceiptCount: 1,
		TotalBytes:   1024,
		Status:       models.SettlementManifestSettled,
	}
}

// EmitSampleReceipt signs a one-window receipt without Postgres. Does not send SOL.
func EmitSampleReceipt(secret, escrowTx string) (PortableReceipt, error) {
	if strings.TrimSpace(secret) == "" {
		var err error
		secret, err = GenerateSigningSecret()
		if err != nil {
			return PortableReceipt{}, err
		}
	}
	m := SampleManifest()
	r := FromManifest(&m, escrowTx)
	if err := SignReceipt(&r, secret); err != nil {
		return PortableReceipt{}, err
	}
	return r, nil
}

// CanonicalReceiptBytes is the exact message signed/verified.
func CanonicalReceiptBytes(r PortableReceipt) []byte {
	msg := fmt.Sprintf("%s%s|%s|%s|%s|%d|%d|%s|%s|%d",
		receiptPrefix,
		strings.TrimSpace(r.WindowKey),
		strings.TrimSpace(r.SessionID),
		strings.TrimSpace(r.UserRef),
		strings.TrimSpace(r.ProviderRef),
		r.ReceiptCount,
		r.TotalBytes,
		strings.TrimSpace(r.Status),
		strings.TrimSpace(r.EscrowTx),
		r.IssuedAt,
	)
	return []byte(msg)
}

// FromManifest builds an unsigned portable receipt from a PG settlement window.
func FromManifest(m *models.SettlementManifest, escrowTx string) PortableReceipt {
	r := PortableReceipt{
		MessageType:  ReceiptMessageType,
		Version:      ReceiptVersion,
		IssuedAt:     time.Now().UTC().Unix(),
		Note:         "Portable settlement receipt. Not trustless metering. Remaining SPOF is the attester (ADR 0010).",
	}
	if m != nil {
		r.WindowKey = m.WindowKey
		r.SessionID = m.SessionID.String()
		r.UserRef = m.UserRef
		r.ProviderRef = m.ProviderRef
		r.ReceiptCount = m.ReceiptCount
		r.TotalBytes = m.TotalBytes
		r.Status = string(m.Status)
	}
	r.EscrowTx = strings.TrimSpace(escrowTx)
	return r
}

// SignReceipt signs canonical bytes.
func SignReceipt(r *PortableReceipt, secret string) error {
	if r == nil {
		return fmt.Errorf("receipt is nil")
	}
	if strings.TrimSpace(r.WindowKey) == "" || strings.TrimSpace(r.SessionID) == "" {
		return fmt.Errorf("window_key and session_id required")
	}
	if r.IssuedAt <= 0 {
		r.IssuedAt = time.Now().UTC().Unix()
	}
	priv, pub, err := proofs.DecodeSigningKey(secret)
	if err != nil {
		return err
	}
	sig := ed25519.Sign(priv, CanonicalReceiptBytes(*r))
	r.Signature = base58.Encode(sig)
	r.IssuerPubkey = base58.Encode(pub)
	return nil
}

// VerifyReceipt checks Ed25519 over canonical bytes.
func VerifyReceipt(r PortableReceipt) bool {
	pubRaw, err := base58.Decode(strings.TrimSpace(r.IssuerPubkey))
	if err != nil || len(pubRaw) != ed25519.PublicKeySize {
		return false
	}
	sigRaw, err := base58.Decode(strings.TrimSpace(r.Signature))
	if err != nil || len(sigRaw) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(ed25519.PublicKey(pubRaw), CanonicalReceiptBytes(r), sigRaw)
}

// ParseReceipt decodes a portable receipt document.
func ParseReceipt(raw []byte) (*PortableReceipt, error) {
	var r PortableReceipt
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, err
	}
	if r.MessageType != ReceiptMessageType {
		return nil, fmt.Errorf("unexpected message_type %q", r.MessageType)
	}
	return &r, nil
}
