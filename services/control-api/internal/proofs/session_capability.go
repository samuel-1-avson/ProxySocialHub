package proofs

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/mr-tron/base58"
)

const (
	// SessionCapabilityPrefix is the Wave 7.A canonical lease prefix.
	SessionCapabilityPrefix  = "PROXYHUB_SESSION_CAPABILITY:v1:"
	SessionCapabilityVersion = "1"
)

// SessionCapabilityPayload is the signed lease (self-contained at CONNECT verify).
// Username is bound via hash so the token cannot be replayed under another proxy user.
type SessionCapabilityPayload struct {
	SessionID      string
	OfferHash      string // listing_offer_hash, else listing_id (not a PDA)
	BuyerID        string
	ExpiresAt      int64
	BandwidthLimit int64
	OperatorPubkey string // base58 Ed25519
	UsernameHash   string
	IssuedAt       int64
}

// CanonicalSessionCapabilityBytes is the exact message signed/verified (stable field order).
func CanonicalSessionCapabilityBytes(p SessionCapabilityPayload) []byte {
	msg := fmt.Sprintf("%s%s|%s|%s|%d|%d|%s|%s|%d",
		SessionCapabilityPrefix,
		strings.TrimSpace(p.SessionID),
		strings.TrimSpace(p.OfferHash),
		strings.TrimSpace(p.BuyerID),
		p.ExpiresAt,
		p.BandwidthLimit,
		strings.TrimSpace(p.OperatorPubkey),
		strings.TrimSpace(p.UsernameHash),
		p.IssuedAt,
	)
	return []byte(msg)
}

// SessionCapabilitySigningSecret is PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY (base58 seed/key).
func SessionCapabilitySigningSecret() string {
	return strings.TrimSpace(os.Getenv("PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY"))
}

// SessionCapabilityOperatorPubkey is an optional bind override.
// Empty means "use the issuer pubkey" (honest W7.A: platform still mints).
func SessionCapabilityOperatorPubkey() string {
	return strings.TrimSpace(os.Getenv("PROXYHUB_SESSION_CAPABILITY_OPERATOR_PUBKEY"))
}

// SessionCapabilityIssuerPubkey is the advertised verify key (env, else derived from signing key).
func SessionCapabilityIssuerPubkey() string {
	if raw := strings.TrimSpace(os.Getenv("PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY")); raw != "" {
		return strings.Split(raw, ",")[0]
	}
	secret := SessionCapabilitySigningSecret()
	if secret == "" {
		return ""
	}
	_, pub, err := DecodeSigningKey(secret)
	if err != nil {
		return ""
	}
	return base58.Encode(pub)
}

// SignSessionCapability signs canonical lease bytes. Returns base58 sig + issuer pubkey.
func SignSessionCapability(p SessionCapabilityPayload, secret string) (sigB58, issuerPubB58 string, err error) {
	priv, pub, err := DecodeSigningKey(secret)
	if err != nil {
		return "", "", err
	}
	if strings.TrimSpace(p.SessionID) == "" || strings.TrimSpace(p.BuyerID) == "" {
		return "", "", fmt.Errorf("session capability: session_id and buyer_id required")
	}
	if strings.TrimSpace(p.UsernameHash) == "" {
		return "", "", fmt.Errorf("session capability: username_hash required")
	}
	if p.IssuedAt <= 0 {
		p.IssuedAt = time.Now().UTC().Unix()
	}
	if p.ExpiresAt <= 0 {
		p.ExpiresAt = p.IssuedAt + 24*3600
	}
	if strings.TrimSpace(p.OperatorPubkey) == "" {
		p.OperatorPubkey = base58.Encode(pub)
	}
	sig := ed25519.Sign(priv, CanonicalSessionCapabilityBytes(p))
	return base58.Encode(sig), base58.Encode(pub), nil
}

// VerifySessionCapabilitySignature checks Ed25519 over canonical bytes (no expiry).
func VerifySessionCapabilitySignature(p SessionCapabilityPayload, sigB58, issuerPubB58 string) bool {
	pubRaw, err := base58.Decode(strings.TrimSpace(issuerPubB58))
	if err != nil || len(pubRaw) != ed25519.PublicKeySize {
		return false
	}
	sigRaw, err := base58.Decode(strings.TrimSpace(sigB58))
	if err != nil || len(sigRaw) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(ed25519.PublicKey(pubRaw), CanonicalSessionCapabilityBytes(p), sigRaw)
}

// SessionCapabilityExpired is true when expires_at is in the past (expires_at<=0 treated as expired).
func SessionCapabilityExpired(expiresAt int64, now time.Time) bool {
	if expiresAt <= 0 {
		return true
	}
	return now.UTC().Unix() > expiresAt
}

const (
	// SessionCapabilityTokenPrefix is the CONNECT password prefix (W7.C).
	SessionCapabilityTokenPrefix = "phubb1."
)

// SessionCapabilityToken is the self-contained wire object (JSON, then base64url).
type SessionCapabilityToken struct {
	Version        string `json:"v"`
	SessionID      string `json:"session_id"`
	OfferHash      string `json:"offer_hash"`
	BuyerID        string `json:"buyer_id"`
	ExpiresAt      int64  `json:"expires_at"`
	BandwidthLimit int64  `json:"bandwidth_limit"`
	OperatorPubkey string `json:"operator_pubkey"`
	UsernameHash   string `json:"username_hash"`
	IssuedAt       int64  `json:"issued_at"`
	Signature      string `json:"signature"`
	IssuerPubkey   string `json:"issuer_pubkey"`
}

// Payload returns the signed lease fields.
func (t *SessionCapabilityToken) Payload() SessionCapabilityPayload {
	if t == nil {
		return SessionCapabilityPayload{}
	}
	return SessionCapabilityPayload{
		SessionID:      t.SessionID,
		OfferHash:      t.OfferHash,
		BuyerID:        t.BuyerID,
		ExpiresAt:      t.ExpiresAt,
		BandwidthLimit: t.BandwidthLimit,
		OperatorPubkey: t.OperatorPubkey,
		UsernameHash:   t.UsernameHash,
		IssuedAt:       t.IssuedAt,
	}
}

// EncodeSessionCapabilityToken packs payload+sig+issuer as phubb1.<base64url json>.
func EncodeSessionCapabilityToken(p SessionCapabilityPayload, sigB58, issuerPubB58 string) (string, error) {
	if strings.TrimSpace(sigB58) == "" || strings.TrimSpace(issuerPubB58) == "" {
		return "", fmt.Errorf("session capability token: signature and issuer required")
	}
	if strings.TrimSpace(p.OperatorPubkey) == "" {
		p.OperatorPubkey = strings.TrimSpace(issuerPubB58)
	}
	tok := SessionCapabilityToken{
		Version:        SessionCapabilityVersion,
		SessionID:      strings.TrimSpace(p.SessionID),
		OfferHash:      strings.TrimSpace(p.OfferHash),
		BuyerID:        strings.TrimSpace(p.BuyerID),
		ExpiresAt:      p.ExpiresAt,
		BandwidthLimit: p.BandwidthLimit,
		OperatorPubkey: strings.TrimSpace(p.OperatorPubkey),
		UsernameHash:   strings.TrimSpace(p.UsernameHash),
		IssuedAt:       p.IssuedAt,
		Signature:      strings.TrimSpace(sigB58),
		IssuerPubkey:   strings.TrimSpace(issuerPubB58),
	}
	raw, err := json.Marshal(tok)
	if err != nil {
		return "", err
	}
	return SessionCapabilityTokenPrefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

// DecodeSessionCapabilityToken parses a phubb1. wire token (no signature check).
func DecodeSessionCapabilityToken(wire string) (*SessionCapabilityToken, error) {
	wire = strings.TrimSpace(wire)
	if !strings.HasPrefix(wire, SessionCapabilityTokenPrefix) {
		return nil, fmt.Errorf("session capability token: missing %s prefix", SessionCapabilityTokenPrefix)
	}
	enc := strings.TrimPrefix(wire, SessionCapabilityTokenPrefix)
	raw, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		return nil, fmt.Errorf("session capability token: base64: %w", err)
	}
	var tok SessionCapabilityToken
	if err := json.Unmarshal(raw, &tok); err != nil {
		return nil, fmt.Errorf("session capability token: json: %w", err)
	}
	if tok.Version != "" && tok.Version != SessionCapabilityVersion {
		return nil, fmt.Errorf("session capability token: unsupported version %q", tok.Version)
	}
	if tok.Version == "" {
		tok.Version = SessionCapabilityVersion
	}
	return &tok, nil
}

// LooksLikeSessionCapabilityToken is true when the password is a W7.C wire token.
func LooksLikeSessionCapabilityToken(wire string) bool {
	return strings.HasPrefix(strings.TrimSpace(wire), SessionCapabilityTokenPrefix)
}
