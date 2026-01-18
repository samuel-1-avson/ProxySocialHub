package crypto

import (
	"crypto/ecdsa"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// Signer handles ECDSA signing for smart contract verification
type Signer struct {
	privateKey *ecdsa.PrivateKey
}

// NewSigner creates a signer from a hex private key
func NewSigner(hexKey string) (*Signer, error) {
	privateKey, err := crypto.HexToECDSA(hexKey)
	if err != nil {
		return nil, fmt.Errorf("invalid private key: %w", err)
	}
	return &Signer{privateKey: privateKey}, nil
}

// SignUsage generates an Ethereum-compatible signature for usage data
// Matches Solidity: keccak256(abi.encodePacked(buyer, provider, bytesUsed, nonce))
func (s *Signer) SignUsage(buyer string, provider string, bytesUsed uint64, nonce uint64) ([]byte, error) {
	if !common.IsHexAddress(buyer) || !common.IsHexAddress(provider) {
		return nil, fmt.Errorf("invalid address format")
	}

	buyerAddr := common.HexToAddress(buyer)
	providerAddr := common.HexToAddress(provider)
	bytesUsedBig := new(big.Int).SetUint64(bytesUsed)
	nonceBig := new(big.Int).SetUint64(nonce)

	// abi.encodePacked equivalent
	// address is 20 bytes, uint256 is 32 bytes
	// But in encodePacked, types are concatenated closely.
	// Ensure we pack them exactly as Solidity does.

	// Implementation note:
	// Go-ethereum doesn't have a direct "EncodePacked" helper that is easy to use for this mix.
	// We manually construct the byte array.

	data := []byte{}
	data = append(data, buyerAddr.Bytes()...)
	data = append(data, providerAddr.Bytes()...)
	data = append(data, common.LeftPadBytes(bytesUsedBig.Bytes(), 32)...) // uint256
	data = append(data, common.LeftPadBytes(nonceBig.Bytes(), 32)...)     // uint256

	hash := crypto.Keccak256(data)

	// Add Ethereum Message Prefix (EIP-191)
	// "\x19Ethereum Signed Message:\n32" + hash
	prefixedHash := crypto.Keccak256Hash(
		[]byte(fmt.Sprintf("\x19Ethereum Signed Message:\n%d", len(hash))),
		hash,
	)

	signature, err := crypto.Sign(prefixedHash.Bytes(), s.privateKey)
	if err != nil {
		return nil, err
	}

	// Adjust V value (0/1 -> 27/28) if needed by specific verify implementations,
	// but standard crypto.Sign returns 0/1 for V (last byte).
	// OpenZeppelin's ECDSA.recover usually expects 27/28.
	if signature[64] < 27 {
		signature[64] += 27
	}

	return signature, nil
}
