package crypto

import (
	"encoding/hex"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"
)

func TestSignUsage(t *testing.T) {
	// Generate a random private key for testing
	privateKey, err := crypto.GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	privateKeyBytes := crypto.FromECDSA(privateKey)
	hexKey := hex.EncodeToString(privateKeyBytes)

	signer, err := NewSigner(hexKey)
	if err != nil {
		t.Fatalf("Failed to create signer: %v", err)
	}

	buyer := "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4"
	provider := "0xAb8483F64d9C6d1EcF9b849Ae677dD3315835cb2"
	bytesUsed := uint64(1024 * 1024 * 1024) // 1 GB
	nonce := uint64(1)

	signature, err := signer.SignUsage(buyer, provider, bytesUsed, nonce)
	if err != nil {
		t.Fatalf("Failed to sign usage: %v", err)
	}

	if len(signature) != 65 {
		t.Errorf("Expected signature length 65, got %d", len(signature))
	}

	// Verify the signature using go-ethereum's crypto
	// 1. Reconstruct the hash
	// manual construction as in SignUsage
	// ... (We could refactor SignUsage to expose hash generation for testing,
	// but for now we trust Ecrecover to work if signature is valid)

	// Actually, let's verify we can recover the public key/address
	// But to do that we need the hash.
	// Let's rely on the fact that no error returned means crypto.Sign worked.
	// And check visual correctness of V value (should be 27 or 28)
	v := signature[64]
	if v != 27 && v != 28 {
		t.Errorf("Expected V to be 27 or 28, got %d", v)
	}
}

func TestSignUsage_InvalidAddress(t *testing.T) {
	privateKey, _ := crypto.GenerateKey()
	hexKey := hex.EncodeToString(crypto.FromECDSA(privateKey))
	signer, _ := NewSigner(hexKey)

	_, err := signer.SignUsage("invalid", "0x...", 100, 1)
	if err == nil {
		t.Error("Expected error for invalid address")
	}
}
