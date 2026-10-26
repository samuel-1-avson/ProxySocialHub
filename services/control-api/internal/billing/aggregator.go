package billing

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
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

// VerifySignature validates the Ed25519 signature on a usage report before any
// counters are updated. Verification fails closed: any report that cannot be
// cryptographically verified is rejected. Empty or unverifiable signatures are
// only accepted when ALLOW_UNSIGNED_USAGE is explicitly enabled in a
// non-production environment.
//
// Verification order:
//  1. GATEWAY_USAGE_PUBLIC_KEY (hex or base58) when set — preferred for edge metering
//  2. Provider hotkey / linked wallet pubkey (legacy)
//
// Callers must mount the report route behind requireGatewayAuth; signature alone
// is not a substitute for gateway authentication.
func (a *Aggregator) VerifySignature(sessionUsername string, bytesUp, bytesDown int64, nonce uint64, signatureHex string) error {
	if strings.TrimSpace(signatureHex) == "" {
		if allowUnsignedUsageReports() {
			return nil
		}
		return fmt.Errorf("usage signature required")
	}

	if gwKey := strings.TrimSpace(os.Getenv("GATEWAY_USAGE_PUBLIC_KEY")); gwKey != "" {
		return verifyUsageSignature(gwKey, sessionUsername, bytesUp, bytesDown, nonce, signatureHex)
	}

	if redis.Client == nil {
		return fmt.Errorf("usage verification unavailable: redis client not initialized")
	}
	sessionData, err := redis.GetSession(sessionUsername)
	if err != nil {
		return fmt.Errorf("session not found: %w", err)
	}
	providerPubKey, err := a.getProviderPublicKey(sessionData.ProviderID)
	if err != nil {
		// Fail closed: without any verification key material, a non-empty signature
		// is unverifiable and must not be treated as valid. The only exception is
		// the explicit non-production ALLOW_UNSIGNED_USAGE escape hatch.
		if allowUnsignedUsageReports() {
			logging.Warn().
				Str("session", sessionUsername).
				Err(err).
				Msg("GATEWAY_USAGE_PUBLIC_KEY unset and provider pubkey missing; accepting usage report under ALLOW_UNSIGNED_USAGE (non-production)")
			return nil
		}
		return fmt.Errorf("no usage verification key available for session %s: %w", sessionUsername, err)
	}
	if err := verifyUsageSignature(providerPubKey, sessionUsername, bytesUp, bytesDown, nonce, signatureHex); err != nil {
		return fmt.Errorf("usage signature verification failed: %w", err)
	}
	return nil
}

func allowUnsignedUsageReports() bool {
	if !strings.EqualFold(strings.TrimSpace(os.Getenv("ALLOW_UNSIGNED_USAGE")), "true") {
		return false
	}
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	switch env {
	case "", "development", "dev", "test", "local":
		return true
	default:
		return false
	}
}

// AggregateUsage verifies signature and aggregates usage in Redis pending ledger
func (a *Aggregator) AggregateUsage(sessionUsername string, bytesUp, bytesDown int64, signatureHex string, nonce uint64) error {
	if err := a.VerifySignature(sessionUsername, bytesUp, bytesDown, nonce, signatureHex); err != nil {
		return err
	}

	sessionData, err := redis.GetSession(sessionUsername)
	if err != nil {
		return fmt.Errorf("session not found: %w", err)
	}

	return a.aggregatePendingUsage(sessionData.SessionID, sessionData.ProviderID, bytesUp+bytesDown)
}

// AggregateReceipt applies a durable usage receipt to the Redis pending ledger.
// A receipt-level SetNX guard makes retries safe after partial failures.
func (a *Aggregator) AggregateReceipt(receipt *models.UsageReceipt) (bool, error) {
	if receipt == nil {
		return false, fmt.Errorf("usage receipt is required")
	}
	if receipt.SessionID.String() == "" {
		return false, fmt.Errorf("usage receipt has no session id")
	}
	if redis.Client == nil {
		return false, fmt.Errorf("redis client not initialized")
	}

	totalBytes := receipt.TotalBytes
	if totalBytes == 0 {
		totalBytes = receipt.BytesUp + receipt.BytesDown
	}

	applyKey := fmt.Sprintf("billing:receipt:%s:applied", receipt.ID.String())
	applied, err := redis.Client.SetNX(context.Background(), applyKey, time.Now().Unix(), 7*24*time.Hour).Result()
	if err != nil {
		return false, fmt.Errorf("failed to reserve receipt idempotency key: %w", err)
	}
	if !applied {
		return false, nil
	}

	if err := a.aggregatePendingUsage(receipt.SessionID.String(), receipt.ProviderRef, totalBytes); err != nil {
		_ = redis.Client.Del(context.Background(), applyKey).Err()
		return false, err
	}

	return true, nil
}

func (a *Aggregator) aggregatePendingUsage(sessionID, providerID string, totalBytes int64) error {
	if redis.Client == nil {
		return fmt.Errorf("redis client not initialized")
	}

	pendingKey := fmt.Sprintf("billing:session:%s:pending", sessionID)
	if err := redis.Client.IncrBy(context.Background(), pendingKey, totalBytes).Err(); err != nil {
		return fmt.Errorf("failed to update pending bytes: %w", err)
	}

	// P0-7: snapshot the SOL/USD price at consumption time (first write
	// wins for this settling period) so settlement never depends solely on
	// a live feed being available hours later.
	if price := GetSOLPriceUSD(); price > 0 {
		priceKey := SessionPriceSnapshotKey(sessionID)
		_ = redis.Client.SetNX(context.Background(), priceKey, price, 0).Err()
	}

	if providerID != "" {
		providerKey := fmt.Sprintf("billing:provider:%s:pending", providerID)
		if err := redis.Client.IncrBy(context.Background(), providerKey, totalBytes).Err(); err != nil {
			logging.Warn().Str("provider", providerID).Msg("Failed to track provider earnings")
		}
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

	// Fallback: Try LinkedWallet (Solana)
	var linkedWallet models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND chain = ? AND verified = true",
		providerID, models.ChainSolana).First(&linkedWallet).Error; err == nil {
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

// SessionPriceSnapshotKey is the Redis key holding the consumption-time
// SOL/USD snapshot for a session's pending bytes (P0-7).
func SessionPriceSnapshotKey(sessionID string) string {
	return fmt.Sprintf("billing:session:%s:sol_price_usd", sessionID)
}

// PriceSnapshotKeyForPendingKey derives the snapshot key from a pending key.
func PriceSnapshotKeyForPendingKey(pendingKey string) string {
	const suffix = ":pending"
	if strings.HasSuffix(pendingKey, suffix) {
		return strings.TrimSuffix(pendingKey, suffix) + ":sol_price_usd"
	}
	return pendingKey + ":sol_price_usd"
}
