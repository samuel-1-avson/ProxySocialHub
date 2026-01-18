package crypto

import (
	"crypto/ecdsa"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// Signer handles Ethereum-based signing operations
type Signer struct {
	privateKey *ecdsa.PrivateKey
}

// NewSigner creates a new Signer from a hex-encoded private key
func NewSigner(privateKeyHex string) (*Signer, error) {
	if len(privateKeyHex) > 2 && privateKeyHex[:2] == "0x" {
		privateKeyHex = privateKeyHex[2:]
	}

	privateKey, err := crypto.HexToECDSA(privateKeyHex)
	if err != nil {
		return nil, fmt.Errorf("invalid private key: %w", err)
	}

	return &Signer{privateKey: privateKey}, nil
}

// SignUsage generates an EIP-191 signature for a usage claim
// Corresponds to Solidity: keccak256(abi.encodePacked(_buyer, _provider, _bytesUsed, _nonce))
func (s *Signer) SignUsage(buyer, provider string, bytesUsed, nonce *big.Int) ([]byte, error) {
	if !common.IsHexAddress(buyer) || !common.IsHexAddress(provider) {
		return nil, errors.New("invalid address format")
	}

	buyerAddr := common.HexToAddress(buyer)
	providerAddr := common.HexToAddress(provider)

	// mimic abi.encodePacked
	// address (20 bytes) + address (20 bytes) + uint256 (32 bytes) + uint256 (32 bytes)
	packed := []byte{}
	packed = append(packed, buyerAddr.Bytes()...)
	packed = append(packed, providerAddr.Bytes()...)
	packed = append(packed, common.LeftPadBytes(bytesUsed.Bytes(), 32)...)
	packed = append(packed, common.LeftPadBytes(nonce.Bytes(), 32)...)

	// Keccak256 hash of the packed arguments
	hash := crypto.Keccak256(packed)

	// Sign the hash with EIP-191 prefix
	signature, err := s.SignHash(hash)
	if err != nil {
		return nil, err
	}

	// Add 27 to recovery ID to match Ethereum standard (v = 27 or 28)
	// crypto.Sign returns [R || S || V] where V is 0 or 1
	if signature[64] < 27 {
		signature[64] += 27
	}

	return signature, nil
}

// SignMessage signs a generic message (EIP-191)
func (s *Signer) SignMessage(message []byte) ([]byte, error) {
	hash := crypto.Keccak256(message)
	return s.SignHash(hash)
}

// SignHash signs a 32-byte hash with the EIP-191 prefix
func (s *Signer) SignHash(hash []byte) ([]byte, error) {
	// EIP-191 prefix
	prefixedHash := crypto.Keccak256(
		[]byte(fmt.Sprintf("\x19Ethereum Signed Message:\n32%s", string(hash))),
	)

	return crypto.Sign(prefixedHash, s.privateKey)
}

// Address returns the public address of the signer
func (s *Signer) Address() string {
	publicKey := s.privateKey.Public()
	publicKeyECDSA, ok := publicKey.(*ecdsa.PublicKey)
	if !ok {
		return ""
	}
	return crypto.PubkeyToAddress(*publicKeyECDSA).Hex()
}

// ByteToString converts a byte slice to a hex string with 0x prefix
func ByteToString(b []byte) string {
	return "0x" + hex.EncodeToString(b)
}
