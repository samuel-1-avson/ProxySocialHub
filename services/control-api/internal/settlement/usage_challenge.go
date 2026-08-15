package settlement

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	// UsageChallengeMessageType is the off-chain petition document (ADR 0015 slice 1).
	UsageChallengeMessageType = "PROXYHUB_USAGE_CHALLENGE"
	UsageChallengeVersion     = "1"
	usageChallengePrefix      = "PROXYHUB_USAGE_CHALLENGE:v1:"
)

// UsagePetition is a buyer-filed off-chain dispute of a claimed leaves_hash.
// It does not prove or disprove physical bytes. Slice 1 still needs the
// protocol accuser (gateway-bond config.accuser) to open accuse on-chain.
type UsagePetition struct {
	MessageType      string          `json:"message_type"`
	Version          string          `json:"version"`
	WindowKey        string          `json:"window_key"`
	LeavesHash       string          `json:"leaves_hash"`
	ReceiptSignature string          `json:"receipt_signature"`
	EvidenceHash     string          `json:"evidence_hash"`
	Receipt          PortableReceipt `json:"receipt"`
	ResolvePath      string          `json:"resolve_path"`
	Note             string          `json:"note"`
}

// UsageChallengeEvidenceHash is ADR 0015 D1:
//
//	SHA256("PROXYHUB_USAGE_CHALLENGE:v1:" || window_key || "|" || hex(leaves_hash) || "|" || receipt_signature)
//
// leaves_hash is 32 bytes, hex-encoded lowercase in the message. receipt_signature
// is the portable receipt's base58 Ed25519 signature string (empty allowed in the
// hash; BuildPetition still requires a verified receipt).
func UsageChallengeEvidenceHash(windowKey, leavesHashHex, receiptSignature string) ([32]byte, error) {
	windowKey = strings.TrimSpace(windowKey)
	if windowKey == "" {
		return [32]byte{}, fmt.Errorf("window_key required")
	}
	leaves, err := ParseLeavesHashHex(leavesHashHex)
	if err != nil {
		return [32]byte{}, err
	}
	msg := usageChallengePrefix + windowKey + "|" + hex.EncodeToString(leaves[:]) + "|" + strings.TrimSpace(receiptSignature)
	return sha256.Sum256([]byte(msg)), nil
}

// ParseLeavesHashHex accepts 64 hex chars, optional 0x prefix. Rejects all-zero.
func ParseLeavesHashHex(s string) ([32]byte, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(strings.ToLower(s), "0x")
	raw, err := hex.DecodeString(s)
	if err != nil {
		return [32]byte{}, fmt.Errorf("leaves_hash: %w", err)
	}
	if len(raw) != 32 {
		return [32]byte{}, fmt.Errorf("leaves_hash must be 32 bytes, got %d", len(raw))
	}
	var out [32]byte
	copy(out[:], raw)
	if out == ([32]byte{}) {
		return [32]byte{}, fmt.Errorf("leaves_hash must be non-zero")
	}
	return out, nil
}

// BuildPetition verifies the settlement receipt and binds a disputed leaves_hash.
func BuildPetition(receipt PortableReceipt, leavesHashHex string) (UsagePetition, error) {
	if !VerifyReceipt(receipt) {
		return UsagePetition{}, fmt.Errorf("receipt signature did not verify")
	}
	windowKey := strings.TrimSpace(receipt.WindowKey)
	sig := strings.TrimSpace(receipt.Signature)
	sum, err := UsageChallengeEvidenceHash(windowKey, leavesHashHex, sig)
	if err != nil {
		return UsagePetition{}, err
	}
	leaves, err := ParseLeavesHashHex(leavesHashHex)
	if err != nil {
		return UsagePetition{}, err
	}
	return UsagePetition{
		MessageType:      UsageChallengeMessageType,
		Version:          UsageChallengeVersion,
		WindowKey:        windowKey,
		LeavesHash:       hex.EncodeToString(leaves[:]),
		ReceiptSignature: sig,
		EvidenceHash:     hex.EncodeToString(sum[:]),
		Receipt:          receipt,
		ResolvePath:      "release",
		Note:             "Disputes the claimed leaves_hash, not physical bytes. Slice 1 is not permissionless buyer-to-chain. Not DePIN. Not trustless metering.",
	}, nil
}

// VerifyPetition checks receipt, field binding, and D1 evidence hash.
func VerifyPetition(p UsagePetition) error {
	if p.MessageType != UsageChallengeMessageType {
		return fmt.Errorf("unexpected message_type %q", p.MessageType)
	}
	if !VerifyReceipt(p.Receipt) {
		return fmt.Errorf("receipt signature did not verify")
	}
	if strings.TrimSpace(p.WindowKey) != strings.TrimSpace(p.Receipt.WindowKey) {
		return fmt.Errorf("window_key does not match receipt")
	}
	if strings.TrimSpace(p.ReceiptSignature) != strings.TrimSpace(p.Receipt.Signature) {
		return fmt.Errorf("receipt_signature does not match receipt")
	}
	sum, err := UsageChallengeEvidenceHash(p.WindowKey, p.LeavesHash, p.ReceiptSignature)
	if err != nil {
		return err
	}
	want := hex.EncodeToString(sum[:])
	if !strings.EqualFold(strings.TrimSpace(p.EvidenceHash), want) {
		return fmt.Errorf("evidence_hash mismatch")
	}
	if p.ResolvePath != "" && p.ResolvePath != "release" {
		return fmt.Errorf("slice 1 resolve_path must be release (got %q); slash/clawback are not this client", p.ResolvePath)
	}
	return nil
}

// ParsePetition decodes a usage-challenge petition document.
func ParsePetition(raw []byte) (*UsagePetition, error) {
	var p UsagePetition
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.MessageType != UsageChallengeMessageType {
		return nil, fmt.Errorf("unexpected message_type %q", p.MessageType)
	}
	return &p, nil
}

// EvidenceHashBytes returns the 32-byte D1 digest from a verified petition.
func EvidenceHashBytes(p UsagePetition) ([32]byte, error) {
	if err := VerifyPetition(p); err != nil {
		return [32]byte{}, err
	}
	return UsageChallengeEvidenceHash(p.WindowKey, p.LeavesHash, p.ReceiptSignature)
}
