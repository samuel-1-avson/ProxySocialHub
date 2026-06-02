package api

import (
	"os"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/proofs"
)

const providerProofMaxAge = 10 * time.Minute

type providerProofResult struct {
	Hash              string
	Signature         string
	Signer            string
	SignedAt          *time.Time
	Verified          bool
	VerificationError string
	Nonce             string
	Present           bool
}

func providerProofMode() string {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("PROVIDER_SIGNATURE_MODE")))
	switch mode {
	case "enforce", "strict", "required":
		return "enforce"
	default:
		return "observe"
	}
}

func providerProofRequired() bool {
	return providerProofMode() == "enforce"
}

func providerProofPresent(proof models.ProviderProof) bool {
	return strings.TrimSpace(proof.Signature) != "" ||
		strings.TrimSpace(proof.ProviderHotkey) != "" ||
		strings.TrimSpace(proof.PayloadHash) != ""
}

func verifyProviderProof(proof models.ProviderProof, expectedType, expectedHotkey, expectedPayloadHash string) providerProofResult {
	result := providerProofResult{
		Hash:      strings.TrimSpace(proof.PayloadHash),
		Signature: strings.TrimSpace(proof.Signature),
		Signer:    strings.TrimSpace(proof.ProviderHotkey),
		Verified:  false,
		Nonce:     strings.TrimSpace(proof.Nonce),
		Present:   providerProofPresent(proof),
	}
	if proof.IssuedAt > 0 {
		signedAt := time.Unix(proof.IssuedAt, 0).UTC()
		result.SignedAt = &signedAt
	}
	if !result.Present {
		result.VerificationError = "unsigned"
		return result
	}

	envelope := proofs.ProviderProofEnvelope{
		MessageType:    proof.MessageType,
		Version:        proof.Version,
		ProviderNodeID: proof.ProviderNodeID,
		GatewayNodeID:  proof.GatewayNodeID,
		ProviderHotkey: proof.ProviderHotkey,
		IssuedAt:       proof.IssuedAt,
		Nonce:          proof.Nonce,
		PayloadHash:    proof.PayloadHash,
		Signature:      proof.Signature,
	}
	if err := proofs.VerifyProviderProof(envelope, expectedType, expectedHotkey, expectedPayloadHash, providerProofMaxAge); err != nil {
		result.VerificationError = err.Error()
		return result
	}
	result.Verified = true
	result.VerificationError = ""
	return result
}
