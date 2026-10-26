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
	"gorm.io/gorm"
)

// stripVerificationSecrets removes stored signature material from API
// responses (W-15: never hand clients a replay kit).
func stripVerificationSecrets(w *models.LinkedWallet) {
	w.VerificationSignature = nil
	w.VerificationMessage = nil
}

func ListLinkedWallets(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var wallets []models.LinkedWallet
	if err := db.DB.Where("user_id = ?", userUUID).Order("is_primary DESC, created_at ASC").Find(&wallets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch wallets"})
		return
	}
	for i := range wallets {
		stripVerificationSecrets(&wallets[i])
	}
	c.JSON(http.StatusOK, wallets)
}

// LinkWalletRequest represents a request to link a new wallet
type LinkWalletRequest struct {
	Chain     models.BlockchainType `json:"chain" binding:"required"`
	Address   string                `json:"address" binding:"required"`
	Signature string                `json:"signature" binding:"required"` // Signature proving ownership
	Message   string                `json:"message" binding:"required"`   // Server-issued challenge message that was signed
	Label     string                `json:"label"`
}

// LinkWallet links a wallet after challenge + signature verification (P0-4).
// Solana links go through the unified identity path (profile + primary +
// withdrawal routing/cooldown) when they become primary; additional Solana
// wallets are stored verified but non-primary. Ethereum links never touch
// the Solana profile identity.
func LinkWallet(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req LinkWalletRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Chain != models.ChainSolana && req.Chain != models.ChainEthereum {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid chain type"})
		return
	}
	req.Address = strings.TrimSpace(req.Address)

	// Single-use server challenge binds user+chain+address (W-15).
	if !consumeLinkChallenge(c.Request.Context(), userUUID, string(req.Chain), req.Address, req.Message) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Link challenge expired or invalid. Request a new challenge."})
		return
	}

	verified := false
	var verifyErr error
	switch req.Chain {
	case models.ChainSolana:
		verified, verifyErr = verifySolanaSignature(req.Address, req.Message, req.Signature)
	case models.ChainEthereum:
		verified, verifyErr = verifyEthereumSignature(req.Address, req.Message, req.Signature)
	}
	if verifyErr != nil {
		logging.Error(verifyErr).Str("chain", string(req.Chain)).Str("address", req.Address).Msg("Signature verification error")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Signature verification failed"})
		return
	}
	if !verified {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid signature - wallet ownership not verified"})
		return
	}

	// Already linked (to anyone) is resolved inside the transaction.
	var user models.User
	if err := db.DB.Where("id = ?", userUUID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	var linked models.LinkedWallet
	status := http.StatusCreated
	txErr := db.DB.Transaction(func(tx *gorm.DB) error {
		var existing models.LinkedWallet
		if err := tx.Where("chain = ? AND address = ?", req.Chain, req.Address).First(&existing).Error; err == nil {
			if existing.UserID != userUUID {
				return fmt.Errorf("wallet already linked to another account")
			}
			linked = existing
			status = http.StatusOK
			return nil
		}

		if req.Chain == models.ChainSolana {
			var primaryCount int64
			if err := tx.Model(&models.LinkedWallet{}).
				Where("user_id = ? AND chain = ? AND is_primary = ?", userUUID, models.ChainSolana, true).
				Count(&primaryCount).Error; err != nil {
				return err
			}
			if primaryCount == 0 {
				// First Solana wallet becomes primary through the ONE
				// identity path (cooldown included — W-04).
				if err := applySolanaLinkIdentity(tx, user, req.Address, &req.Signature, &req.Message); err != nil {
					return err
				}
			} else {
				// Additional verified Solana wallet; primary unchanged.
				row := models.LinkedWallet{
					UserID:                userUUID,
					Chain:                 req.Chain,
					Address:               req.Address,
					Verified:              true,
					VerificationSignature: &req.Signature,
					VerificationMessage:   &req.Message,
					IsPrimary:             false,
					Label:                 &req.Label,
				}
				if err := tx.Create(&row).Error; err != nil {
					return err
				}
			}
		} else {
			if err := applyEthereumLinkIdentity(tx, userUUID, req.Address, &req.Signature, &req.Message); err != nil {
				return err
			}
		}
		return tx.Where("chain = ? AND address = ? AND user_id = ?", req.Chain, req.Address, userUUID).First(&linked).Error
	})
	if txErr != nil {
		if strings.Contains(txErr.Error(), "another account") {
			c.JSON(http.StatusConflict, gin.H{"error": "Wallet already linked to another account"})
			return
		}
		logging.Error(txErr).Str("user_id", userUUID.String()).Str("address", req.Address).Msg("Failed to link wallet")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to link wallet"})
		return
	}

	if req.Label != "" && (linked.Label == nil || *linked.Label == "" || *linked.Label == "Primary") {
		_ = db.DB.Model(&models.LinkedWallet{}).Where("id = ?", linked.ID).Update("label", req.Label).Error
		linked.Label = &req.Label
	}

	logging.Info().
		Str("user_id", userUUID.String()).
		Str("chain", string(req.Chain)).
		Str("address", req.Address).
		Msg("Wallet linked successfully")

	stripVerificationSecrets(&linked)
	c.JSON(status, linked)
}

type setPrimaryRequest struct {
	Signature string `json:"signature"`
	Message   string `json:"message"`
}

// SetPrimaryWallet promotes a linked wallet to primary. For Solana this
// changes the withdrawal destination, so it requires a fresh challenge
// signature from that wallet and goes through the unified identity path
// (24h cooldown applies) — a bare session can no longer do it (W-04).
func SetPrimaryWallet(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	walletID := c.Param("id")

	var wallet models.LinkedWallet
	if err := db.DB.Where("id = ? AND user_id = ?", walletID, userUUID).First(&wallet).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	var req setPrimaryRequest
	_ = c.ShouldBindJSON(&req) // empty body is treated as missing proof below
	if req.Signature == "" || req.Message == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Signature and challenge message required to change primary wallet"})
		return
	}
	if !consumeLinkChallenge(c.Request.Context(), userUUID, string(wallet.Chain), wallet.Address, req.Message) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Link challenge expired or invalid. Request a new challenge."})
		return
	}

	var verified bool
	var verifyErr error
	switch wallet.Chain {
	case models.ChainSolana:
		verified, verifyErr = verifySolanaSignature(wallet.Address, req.Message, req.Signature)
	case models.ChainEthereum:
		verified, verifyErr = verifyEthereumSignature(wallet.Address, req.Message, req.Signature)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported chain"})
		return
	}
	if verifyErr != nil || !verified {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Signature verification failed"})
		return
	}

	var user models.User
	if err := db.DB.Where("id = ?", userUUID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	txErr := db.DB.Transaction(func(tx *gorm.DB) error {
		if wallet.Chain == models.ChainSolana {
			return applySolanaLinkIdentity(tx, user, wallet.Address, &req.Signature, &req.Message)
		}
		return applyEthereumLinkIdentity(tx, userUUID, wallet.Address, &req.Signature, &req.Message)
	})
	if txErr != nil {
		logging.Error(txErr).Str("user_id", userUUID.String()).Str("wallet_id", walletID).Msg("Failed to set primary wallet")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to set primary wallet"})
		return
	}

	if err := db.DB.Where("id = ?", wallet.ID).First(&wallet).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load wallet"})
		return
	}
	stripVerificationSecrets(&wallet)
	c.JSON(http.StatusOK, wallet)
}

func UnlinkWallet(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	walletID := c.Param("id")

	txErr := db.DB.Transaction(func(tx *gorm.DB) error {
		var wallet models.LinkedWallet
		if err := tx.Where("id = ? AND user_id = ?", walletID, userUUID).First(&wallet).Error; err != nil {
			return errWalletNotFound
		}
		if err := tx.Delete(&wallet).Error; err != nil {
			return err
		}
		// Unlinking the primary Solana wallet clears the Solana profile
		// identity + withdrawal routing (fail closed). Ethereum unlinks
		// never touch Solana state (W-05).
		if wallet.IsPrimary && wallet.Chain == models.ChainSolana {
			if err := setProfileWalletAddress(tx, userUUID, nil); err != nil {
				return err
			}
			return clearWalletWithdrawalRouting(tx, userUUID)
		}
		return nil
	})
	if txErr == errWalletNotFound {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}
	if txErr != nil {
		logging.Error(txErr).Str("user_id", userUUID.String()).Str("wallet_id", walletID).Msg("Failed to unlink wallet")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unlink wallet"})
		return
	}

	logging.Info().
		Str("user_id", userUUID.String()).
		Str("wallet_id", walletID).
		Msg("Wallet unlinked")

	c.Status(http.StatusNoContent)
}

var errWalletNotFound = fmt.Errorf("wallet not found")

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
