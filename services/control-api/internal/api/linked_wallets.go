// Package api provides linked wallet management endpoints
package api

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

// @Summary List linked wallets
// @Description Get all wallets linked to the current user
// @Tags wallets
// @Produce json
// @Success 200 {array} models.LinkedWallet
// @Router /v1/linked-wallets [get]
func ListLinkedWallets(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var wallets []models.LinkedWallet
	if err := db.DB.Where("user_id = ?", userID).Order("is_primary DESC, created_at ASC").Find(&wallets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch wallets"})
		return
	}

	c.JSON(http.StatusOK, wallets)
}

// LinkWalletRequest represents a request to link a new wallet
type LinkWalletRequest struct {
	Chain     models.BlockchainType `json:"chain" binding:"required"`
	Address   string                `json:"address" binding:"required"`
	Signature string                `json:"signature" binding:"required"` // Signature proving ownership
	Message   string                `json:"message" binding:"required"`   // Message that was signed
	Label     string                `json:"label"`
}

// @Summary Link a new wallet
// @Description Link a blockchain wallet to the current user account
// @Tags wallets
// @Accept json
// @Produce json
// @Param request body LinkWalletRequest true "Wallet details"
// @Success 201 {object} models.LinkedWallet
// @Router /v1/linked-wallets [post]
func LinkWallet(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req LinkWalletRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate chain type
	if req.Chain != models.ChainSolana && req.Chain != models.ChainEthereum {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid chain type"})
		return
	}

	// Verify signature based on chain
	verified := false
	var verifyErr error
	
	switch req.Chain {
	case models.ChainSolana:
		verified, verifyErr = verifySolanaSignature(req.Address, req.Message, req.Signature)
	case models.ChainEthereum:
		verified, verifyErr = verifyEthereumSignature(req.Address, req.Message, req.Signature)
	}

	if verifyErr != nil {
		logging.Error(verifyErr).
			Str("chain", string(req.Chain)).
			Str("address", req.Address).
			Msg("Signature verification error")
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Verification error: %v", verifyErr)})
		return
	}

	if !verified {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid signature - wallet ownership not verified"})
		return
	}

	// Check if wallet already linked to another user
	var existing models.LinkedWallet
	if err := db.DB.Where("chain = ? AND address = ?", req.Chain, req.Address).First(&existing).Error; err == nil {
		if existing.UserID != userID.(uuid.UUID) {
			c.JSON(http.StatusConflict, gin.H{"error": "Wallet already linked to another account"})
			return
		}
		// Already linked to this user
		c.JSON(http.StatusOK, existing)
		return
	}

	// Check if this is the first wallet (make it primary)
	var count int64
	db.DB.Model(&models.LinkedWallet{}).Where("user_id = ?", userID).Count(&count)
	isPrimary := count == 0

	wallet := models.LinkedWallet{
		UserID:                userID.(uuid.UUID),
		Chain:                 req.Chain,
		Address:               req.Address,
		Verified:              true,
		VerificationSignature: &req.Signature,
		VerificationMessage:   &req.Message,
		IsPrimary:             isPrimary,
		Label:                 &req.Label,
	}

	if err := db.DB.Create(&wallet).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to link wallet"})
		return
	}

	// Also update legacy wallet fields in user profile for backwards compatibility
	if isPrimary {
		db.DB.Model(&models.User{}).Where("id = ?", userID).Update("wallet_address", req.Address)
	}

	logging.Info().
		Str("user_id", userID.(uuid.UUID).String()).
		Str("chain", string(req.Chain)).
		Str("address", req.Address).
		Msg("Wallet linked successfully")

	c.JSON(http.StatusCreated, wallet)
}

// @Summary Set primary wallet
// @Description Set a linked wallet as the primary wallet for a chain
// @Tags wallets
// @Param id path string true "Wallet ID"
// @Success 200 {object} models.LinkedWallet
// @Router /v1/linked-wallets/{id}/primary [put]
func SetPrimaryWallet(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	walletID := c.Param("id")

	// Find the wallet
	var wallet models.LinkedWallet
	if err := db.DB.Where("id = ? AND user_id = ?", walletID, userID).First(&wallet).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	// Unset other primaries for this chain
	db.DB.Model(&models.LinkedWallet{}).
		Where("user_id = ? AND chain = ? AND id != ?", userID, wallet.Chain, wallet.ID).
		Update("is_primary", false)

	// Set this as primary
	wallet.IsPrimary = true
	db.DB.Save(&wallet)

	// Update legacy field
	db.DB.Model(&models.User{}).Where("id = ?", userID).Update("wallet_address", wallet.Address)

	c.JSON(http.StatusOK, wallet)
}

// @Summary Unlink wallet
// @Description Remove a linked wallet from the current user
// @Tags wallets
// @Param id path string true "Wallet ID"
// @Success 204 "No Content"
// @Router /v1/linked-wallets/{id} [delete]
func UnlinkWallet(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	walletID := c.Param("id")

	var wallet models.LinkedWallet
	if err := db.DB.Where("id = ? AND user_id = ?", walletID, userID).First(&wallet).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	if err := db.DB.Delete(&wallet).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unlink wallet"})
		return
	}

	// If this was primary, clear legacy field
	if wallet.IsPrimary {
		db.DB.Model(&models.User{}).Where("id = ?", userID).Update("wallet_address", nil)
	}

	logging.Info().
		Str("user_id", userID.(uuid.UUID).String()).
		Str("wallet_id", walletID).
		Msg("Wallet unlinked")

	c.Status(http.StatusNoContent)
}

// ============================================================================
// SIGNATURE VERIFICATION IMPLEMENTATIONS
// ============================================================================

// verifySolanaSignature verifies an Ed25519 signature for Solana
// Returns true if the signature is valid for the given address and message
func verifySolanaSignature(address, message, signature string) (bool, error) {
	// Decode the Solana address (base58 encoded Ed25519 public key)
	pubKeyBytes, err := base58.Decode(address)
	if err != nil {
		return false, fmt.Errorf("invalid address encoding: %w", err)
	}

	// Verify public key length (Ed25519 public keys are 32 bytes)
	if len(pubKeyBytes) != ed25519.PublicKeySize {
		return false, fmt.Errorf("invalid public key length: expected %d, got %d", 
			ed25519.PublicKeySize, len(pubKeyBytes))
	}

	// Decode the signature (base58 encoded)
	sigBytes, err := base58.Decode(signature)
	if err != nil {
		return false, fmt.Errorf("invalid signature encoding: %w", err)
	}

	// Verify signature length (Ed25519 signatures are 64 bytes)
	if len(sigBytes) != ed25519.SignatureSize {
		return false, fmt.Errorf("invalid signature length: expected %d, got %d",
			ed25519.SignatureSize, len(sigBytes))
	}

	// Verify the Ed25519 signature
	valid := ed25519.Verify(pubKeyBytes, []byte(message), sigBytes)
	if !valid {
		return false, fmt.Errorf("signature verification failed")
	}

	return true, nil
}

// verifyEthereumSignature verifies an ECDSA signature for Ethereum
// Supports both raw hex signatures and prefixed Ethereum signatures
func verifyEthereumSignature(address, message, signature string) (bool, error) {
	// Normalize address
	address = strings.ToLower(address)
	
	// Ensure address has 0x prefix
	if !strings.HasPrefix(address, "0x") {
		address = "0x" + address
	}

	// Validate Ethereum address format
	if !common.IsHexAddress(address) {
		return false, fmt.Errorf("invalid Ethereum address format")
	}

	// Decode signature from hex
	sigBytes, err := hex.DecodeString(strings.TrimPrefix(signature, "0x"))
	if err != nil {
		return false, fmt.Errorf("invalid signature hex: %w", err)
	}

	// Ethereum signatures are 65 bytes: r (32) + s (32) + v (1)
	if len(sigBytes) != 65 {
		return false, fmt.Errorf("invalid signature length: expected 65, got %d", len(sigBytes))
	}

	// Adjust V value if needed (Ethereum uses 27/28 or 0/1)
	v := sigBytes[64]
	if v == 27 || v == 28 {
		sigBytes[64] -= 27
	}

	// Create the Ethereum-signed message hash
	// Ethereum standard: \x19Ethereum Signed Message:\n{len(message)}{message}
	prefix := fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(message), message)
	msgHash := crypto.Keccak256Hash([]byte(prefix))

	// Extract v value (recovery id)
	vValue := sigBytes[64]
	if vValue != 0 && vValue != 1 && vValue != 27 && vValue != 28 {
		return false, fmt.Errorf("invalid recovery id (v): %d", vValue)
	}

	// Recover public key
	pubKey, err := crypto.SigToPub(msgHash.Bytes(), sigBytes)
	if err != nil {
		return false, fmt.Errorf("failed to recover public key: %w", err)
	}

	// Derive address from recovered public key
	recoveredAddr := crypto.PubkeyToAddress(*pubKey)
	
	// Compare addresses (case-insensitive)
	if strings.EqualFold(recoveredAddr.Hex(), address) {
		return true, nil
	}

	// Try without Ethereum prefix (raw signing)
	rawHash := crypto.Keccak256Hash([]byte(message))
	pubKeyRaw, err := crypto.SigToPub(rawHash.Bytes(), sigBytes)
	if err != nil {
		return false, fmt.Errorf("signature does not match address")
	}
	
	recoveredAddrRaw := crypto.PubkeyToAddress(*pubKeyRaw)
	if strings.EqualFold(recoveredAddrRaw.Hex(), address) {
		return true, nil
	}

	return false, fmt.Errorf("signature does not match address")
}

// verifyEIP712Signature verifies an EIP-712 typed data signature.
// It parses the typed data JSON to compute the domain separator and struct hash,
// then recovers the signer address from the EIP-712 hash: keccak256(\x19\x01 || domainSeparator || structHash).
func verifyEIP712Signature(address string, typedData, signature string) (bool, error) {
	// Parse the typed-data envelope
	var envelope struct {
		Domain struct {
			Name              string `json:"name"`
			Version           string `json:"version"`
			ChainID           int64  `json:"chainId"`
			VerifyingContract string `json:"verifyingContract"`
		} `json:"domain"`
		Message map[string]interface{} `json:"message"`
	}
	if err := json.Unmarshal([]byte(typedData), &envelope); err != nil {
		// If the typed data cannot be parsed, fall back to personal-sign verification
		// so that wallets using personal_sign instead of signTypedData still work.
		return verifyEthereumSignature(address, typedData, signature)
	}

	// Compute EIP-712 domain separator:
	// keccak256(abi.encode(typeHash, nameHash, versionHash, chainId, verifyingContract))
	domainTypeHash := crypto.Keccak256([]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))
	nameHash := crypto.Keccak256([]byte(envelope.Domain.Name))
	versionHash := crypto.Keccak256([]byte(envelope.Domain.Version))

	// Encode chainId as uint256
	chainIDBytes := make([]byte, 32)
	big.NewInt(envelope.Domain.ChainID).FillBytes(chainIDBytes)

	// Encode verifying contract
	contractAddr := common.HexToAddress(envelope.Domain.VerifyingContract)
	contractPadded := make([]byte, 32)
	copy(contractPadded[12:], contractAddr.Bytes())

	var domainBuf []byte
	domainBuf = append(domainBuf, domainTypeHash...)
	domainBuf = append(domainBuf, nameHash...)
	domainBuf = append(domainBuf, versionHash...)
	domainBuf = append(domainBuf, chainIDBytes...)
	domainBuf = append(domainBuf, contractPadded...)
	domainSeparator := crypto.Keccak256(domainBuf)

	// For the struct hash, serialise the message fields deterministically.
	// This is a simplified approach: hash the canonical JSON of the message.
	msgJSON, _ := json.Marshal(envelope.Message)
	structHash := crypto.Keccak256(msgJSON)

	// Final EIP-712 hash: keccak256(\x19\x01 || domainSeparator || structHash)
	var eip712Buf []byte
	eip712Buf = append(eip712Buf, 0x19, 0x01)
	eip712Buf = append(eip712Buf, domainSeparator...)
	eip712Buf = append(eip712Buf, structHash...)
	eip712Hash := crypto.Keccak256Hash(eip712Buf)

	// Decode signature
	sigHex := strings.TrimPrefix(signature, "0x")
	sigBytes, err := hex.DecodeString(sigHex)
	if err != nil || len(sigBytes) != 65 {
		return false, fmt.Errorf("invalid signature format")
	}

	// Normalise v value
	if sigBytes[64] >= 27 {
		sigBytes[64] -= 27
	}

	pubKey, err := crypto.SigToPub(eip712Hash.Bytes(), sigBytes)
	if err != nil {
		// If EIP-712 recovery fails, fall back to personal-sign verification
		return verifyEthereumSignature(address, typedData, signature)
	}

	recoveredAddr := crypto.PubkeyToAddress(*pubKey)
	if strings.EqualFold(recoveredAddr.Hex(), address) {
		return true, nil
	}

	// Final fallback: try standard personal-sign verification
	return verifyEthereumSignature(address, typedData, signature)
}

// ============================================================================
// MESSAGE GENERATION HELPERS
// ============================================================================

// GenerateLinkingMessage creates a standard message for wallet linking
// This ensures consistent message format across the application
func GenerateLinkingMessage(userID uuid.UUID, address string, chain models.BlockchainType, timestamp int64) string {
	return fmt.Sprintf(
		"Link wallet %s to ProxyHubb user %s (Chain: %s) at timestamp %d. "+
			"This signature proves ownership of the wallet.",
		address,
		userID.String(),
		chain,
		timestamp,
	)
}

// GenerateTransactionMessage creates a message for transaction signing
func GenerateTransactionMessage(txType string, amount float64, currency string, nonce string) string {
	return fmt.Sprintf(
		"ProxyHubb %s: %.8f %s (Nonce: %s)",
		txType,
		amount,
		currency,
		nonce,
	)
}

// RegisterLinkedWalletRoutes registers linked wallet API routes
func RegisterLinkedWalletRoutes(r *gin.RouterGroup) {
	wallets := r.Group("/linked-wallets")
	{
		wallets.GET("", ListLinkedWallets)
		wallets.POST("", LinkWallet)
		wallets.PUT("/:id/primary", SetPrimaryWallet)
		wallets.DELETE("/:id", UnlinkWallet)
	}
}
