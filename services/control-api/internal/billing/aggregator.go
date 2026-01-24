package billing

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
)

// Aggregator handles usage aggregation and signature verification
type Aggregator struct {
	// Provider key cache TTL
	keyCacheTTL time.Duration
}

func NewAggregator() *Aggregator {
	return &Aggregator{
		keyCacheTTL: 5 * time.Minute,
	}
}

// AggregateUsage verifies signature and aggregates usage in Redis pending ledger
func (a *Aggregator) AggregateUsage(sessionUsername string, bytesUp, bytesDown int64, signatureHex string, nonce uint64) error {
	// 1. Fetch Session & Provider Info
	sessionData, err := redis.GetSession(sessionUsername)
	if err != nil {
		return fmt.Errorf("session not found: %w", err)
	}

	// 2. Verify Signature if provided
	if signatureHex != "" {
		// Fetch Provider's public key (Hotkey) from cache or DB
		providerPubKey, err := a.getProviderPublicKey(sessionData.ProviderID)
		if err != nil {
			logging.Warn().Str("session", sessionUsername).Str("provider", sessionData.ProviderID).Msg("Failed to get provider public key")
			return fmt.Errorf("provider key not found: %w", err)
		}

		if err := verifyUsageSignature(providerPubKey, sessionUsername, bytesUp, bytesDown, nonce, signatureHex); err != nil {
			logging.Warn().Str("session", sessionUsername).Err(err).Msg("Invalid usage signature")
			return fmt.Errorf("invalid signature: %w", err)
		}
	}

	// 3. Atomically Increment Pending Balance in Redis
	totalBytes := bytesUp + bytesDown

	// Increment pending bytes for session
	pendingKey := fmt.Sprintf("billing:session:%s:pending", sessionData.SessionID)
	if err := redis.Client.IncrBy(context.Background(), pendingKey, totalBytes).Err(); err != nil {
		return fmt.Errorf("failed to update pending bytes: %w", err)
	}

	// Track provider earnings (for later settlement)
	providerKey := fmt.Sprintf("billing:provider:%s:pending", sessionData.ProviderID)
	if err := redis.Client.IncrBy(context.Background(), providerKey, totalBytes).Err(); err != nil {
		logging.Warn().Str("provider", sessionData.ProviderID).Msg("Failed to track provider earnings")
	}

	return nil
}

// getProviderPublicKey retrieves the provider's Ed25519 public key from cache or database
func (a *Aggregator) getProviderPublicKey(providerID string) (string, error) {
	if providerID == "" {
		return "", fmt.Errorf("empty provider ID")
	}

	// Check cache first
	cacheKey := fmt.Sprintf("provider:pubkey:%s", providerID)
	if cachedKey, err := redis.Client.Get(context.Background(), cacheKey).Result(); err == nil && cachedKey != "" {
		return cachedKey, nil
	}

	// Lookup from database - try Node first (provider's registered node)
	var node models.Node
	if err := db.DB.Where("provider_user_id = ? AND hotkey != ''", providerID).First(&node).Error; err == nil {
		// Cache the key
		redis.Client.Set(context.Background(), cacheKey, node.Hotkey, a.keyCacheTTL)
		return node.Hotkey, nil
	}

	// Fallback: Try LinkedWallet (Solana or Bittensor)
	var linkedWallet models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND (chain = ? OR chain = ?) AND verified = true",
		providerID, models.ChainSolana, models.ChainBittensor).First(&linkedWallet).Error; err == nil {
		// Cache the key
		redis.Client.Set(context.Background(), cacheKey, linkedWallet.Address, a.keyCacheTTL)
		return linkedWallet.Address, nil
	}

	return "", fmt.Errorf("no public key found for provider %s", providerID)
}

// verifyUsageSignature verifies an Ed25519 signature for usage data
func verifyUsageSignature(providerPubKey, username string, up, down int64, nonce uint64, sigHex string) error {
	// Reconstruct canonical message format: "username:up:down:nonce"
	msg := fmt.Sprintf("%s:%d:%d:%d", username, up, down, nonce)

	// Decode signature (hex format)
	sigBytes, err := hex.DecodeString(sigHex)
	if err != nil {
		return fmt.Errorf("invalid signature hex encoding: %w", err)
	}

	// Validate signature length
	if len(sigBytes) != ed25519.SignatureSize {
		return fmt.Errorf("invalid signature length: expected %d, got %d", ed25519.SignatureSize, len(sigBytes))
	}

	// Decode public key (try base58 first for Solana/Bittensor, then hex)
	var pubKeyBytes []byte
	pubKeyBytes, err = base58.Decode(providerPubKey)
	if err != nil || len(pubKeyBytes) != ed25519.PublicKeySize {
		// Try hex decoding as fallback
		pubKeyBytes, err = hex.DecodeString(providerPubKey)
		if err != nil {
			return fmt.Errorf("invalid public key encoding: %w", err)
		}
	}

	// Validate public key length
	if len(pubKeyBytes) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid public key length: expected %d, got %d", ed25519.PublicKeySize, len(pubKeyBytes))
	}

	// Verify Ed25519 signature
	if !ed25519.Verify(pubKeyBytes, []byte(msg), sigBytes) {
		return fmt.Errorf("signature verification failed")
	}

	logging.Debug().Str("username", username).Msg("Usage signature verified successfully")
	return nil
}
