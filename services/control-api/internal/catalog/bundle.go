package catalog

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
	// BundleMessageType identifies a Wave 9.B portable listing-commitment bundle.
	BundleMessageType = "PROXYHUB_LISTING_COMMITMENT_BUNDLE"
	BundleVersion     = "1"
	entryPrefix       = "PROXYHUB_LISTING_COMMITMENT:v1:"
)

// CommitmentBundle is a signed copy of offer hashes + optional ListingCommitment PDAs.
// Title/media stay Postgres. This is not a merchandising catalog.
type CommitmentBundle struct {
	MessageType  string              `json:"message_type"`
	Version      string              `json:"version"`
	IssuedAt     int64               `json:"issued_at"`
	IssuerPubkey string              `json:"issuer_pubkey,omitempty"`
	Entries      []CommitmentEntry   `json:"entries"`
	Note         string              `json:"note"`
}

// CommitmentEntry is one listing offer-hash (and optional on-chain PDA).
type CommitmentEntry struct {
	ListingID    string `json:"listing_id"`
	Provider     string `json:"provider"`
	OfferHash    string `json:"offer_hash"`
	PDA          string `json:"pda,omitempty"`
	OnChain      bool   `json:"on_chain"`
	IssuedAt     int64  `json:"issued_at"`
	Signature    string `json:"signature"`
}

// BundleConfigured is true when a non-Postgres reconstruct pin is set.
func BundleConfigured() bool {
	return strings.TrimSpace(os.Getenv("PROXYHUB_LISTING_BUNDLE_PATH")) != "" ||
		strings.TrimSpace(os.Getenv("PROXYHUB_LISTING_BUNDLE_URL")) != "" ||
		strings.TrimSpace(os.Getenv("PROXYHUB_LISTING_BUNDLE_CID")) != ""
}

// Source is postgres (API-only) or postgres_cache (bundle pin configured).
func Source() string {
	if BundleConfigured() {
		return "postgres_cache"
	}
	return "postgres"
}

// SigningKey is PROXYHUB_LISTING_BUNDLE_SIGNING_KEY (base58 Ed25519).
func SigningKey() string {
	return strings.TrimSpace(os.Getenv("PROXYHUB_LISTING_BUNDLE_SIGNING_KEY"))
}

// GenerateSigningSecret returns a fresh base58 Ed25519 seed (not persisted).
func GenerateSigningSecret() (string, error) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", err
	}
	return base58.Encode(priv.Seed()), nil
}

// SampleListing is a reconstruct fixture (offer hash only; PDA optional / off-chain).
func SampleListing() models.ProxyListing {
	return models.ProxyListing{
		ID:                 uuid.MustParse("12345678-1234-1234-1234-123456789abc"),
		ListingOfferHash:   "abababababababababababababababababababababababababababababababab",
		ListingOfferSigner: "11111111111111111111111111111111",
	}
}

// Soak listing seeds match the live W9.A PDA (devnet, 2026-08-13).
const (
	SoakListingID = "12121212-1212-1212-1212-121212121212"
	SoakProvider  = "8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2"
	SoakOfferHash = "ab00000000000000000000000000000000000000000000000000000000000000"
)

// SoakListing is the Wave 9.A live-PDA soak row (hashes only until annotated).
func SoakListing() models.ProxyListing {
	return models.ProxyListing{
		ID:                 uuid.MustParse(SoakListingID),
		ListingOfferHash:   SoakOfferHash,
		ListingOfferSigner: SoakProvider,
	}
}

// EmitSampleBundle signs a one-row listing-commitment bundle without Postgres.
func EmitSampleBundle(secret string) (CommitmentBundle, error) {
	if strings.TrimSpace(secret) == "" {
		var err error
		secret, err = GenerateSigningSecret()
		if err != nil {
			return CommitmentBundle{}, err
		}
	}
	return BuildBundle([]models.ProxyListing{SampleListing()}, secret)
}

// CanonicalEntryBytes is the exact message signed/verified (stable field order).
func CanonicalEntryBytes(e CommitmentEntry) []byte {
	pda := strings.TrimSpace(e.PDA)
	msg := fmt.Sprintf("%s%s|%s|%s|%s|%d",
		entryPrefix,
		strings.TrimSpace(e.ListingID),
		strings.TrimSpace(e.Provider),
		strings.ToLower(strings.TrimSpace(e.OfferHash)),
		pda,
		e.IssuedAt,
	)
	return []byte(msg)
}

// SignEntry signs one commitment row.
func SignEntry(e *CommitmentEntry, secret string) (issuer string, err error) {
	if e == nil {
		return "", fmt.Errorf("entry is nil")
	}
	if strings.TrimSpace(e.OfferHash) == "" || strings.TrimSpace(e.ListingID) == "" {
		return "", fmt.Errorf("listing_id and offer_hash required")
	}
	if e.IssuedAt <= 0 {
		e.IssuedAt = time.Now().UTC().Unix()
	}
	priv, pub, err := proofs.DecodeSigningKey(secret)
	if err != nil {
		return "", err
	}
	sig := ed25519.Sign(priv, CanonicalEntryBytes(*e))
	e.Signature = base58.Encode(sig)
	return base58.Encode(pub), nil
}

// VerifyEntry checks Ed25519 over canonical bytes.
func VerifyEntry(e CommitmentEntry, issuerPubB58 string) bool {
	pubRaw, err := base58.Decode(strings.TrimSpace(issuerPubB58))
	if err != nil || len(pubRaw) != ed25519.PublicKeySize {
		return false
	}
	sigRaw, err := base58.Decode(strings.TrimSpace(e.Signature))
	if err != nil || len(sigRaw) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(ed25519.PublicKey(pubRaw), CanonicalEntryBytes(e), sigRaw)
}

// BuildBundle snapshots listings with offer hashes into a portable bundle.
func BuildBundle(listings []models.ProxyListing, secret string) (CommitmentBundle, error) {
	b := CommitmentBundle{
		MessageType: BundleMessageType,
		Version:     BundleVersion,
		IssuedAt:    time.Now().UTC().Unix(),
		Entries:     make([]CommitmentEntry, 0, len(listings)),
		Note:        "Offer-hash commitments plus optional ListingCommitment PDAs. Not a merchandising catalog. Delist stays platform.",
	}
	for i := range listings {
		l := listings[i]
		hash := strings.TrimSpace(l.ListingOfferHash)
		if hash == "" {
			continue
		}
		e := CommitmentEntry{
			ListingID: l.ID.String(),
			Provider:  strings.TrimSpace(l.ListingOfferSigner),
			OfferHash: strings.ToLower(hash),
			PDA:       strings.TrimSpace(l.ListingCommitmentPDA),
			OnChain:   l.ListingCommitmentOnChain,
			IssuedAt:  b.IssuedAt,
		}
		issuer, err := SignEntry(&e, secret)
		if err != nil {
			return CommitmentBundle{}, err
		}
		b.IssuerPubkey = issuer
		b.Entries = append(b.Entries, e)
	}
	return b, nil
}

// ParseBundle decodes a bundle document.
func ParseBundle(raw []byte) (*CommitmentBundle, error) {
	var b CommitmentBundle
	if err := json.Unmarshal(raw, &b); err != nil {
		return nil, err
	}
	if b.MessageType != BundleMessageType {
		return nil, fmt.Errorf("unexpected message_type %q", b.MessageType)
	}
	if strings.TrimSpace(b.Version) == "" {
		b.Version = BundleVersion
	}
	return &b, nil
}

// VerifiedEntry is a verify result row.
type VerifiedEntry struct {
	Entry    CommitmentEntry
	Verified bool
	Reason   string
}

// VerifyBundleEntries verifies every entry against the bundle issuer pubkey.
func VerifyBundleEntries(b *CommitmentBundle) []VerifiedEntry {
	out := make([]VerifiedEntry, 0)
	if b == nil {
		return out
	}
	issuer := strings.TrimSpace(b.IssuerPubkey)
	for _, e := range b.Entries {
		v := VerifiedEntry{Entry: e}
		if issuer == "" {
			v.Reason = "missing issuer_pubkey"
		} else if strings.TrimSpace(e.OfferHash) == "" {
			v.Reason = "missing offer_hash"
		} else if !VerifyEntry(e, issuer) {
			v.Reason = "bad signature"
		} else {
			v.Verified = true
		}
		out = append(out, v)
	}
	return out
}
