package services

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"fmt"

	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/core/ports"
)

type BillingServiceImpl struct {
	billingRepo ports.BillingRepository
	sessionRepo ports.SessionRepository
}

func NewBillingService(billingRepo ports.BillingRepository, sessionRepo ports.SessionRepository) *BillingServiceImpl {
	return &BillingServiceImpl{
		billingRepo: billingRepo,
		sessionRepo: sessionRepo,
	}
}

// ProcessUsage verifies signature and aggregates usage
func (s *BillingServiceImpl) ProcessUsage(ctx context.Context, usage domain.Usage, signatureHex string, nonce uint64) error {
	// 1. Fetch Session
	session, err := s.sessionRepo.GetSession(ctx, usage.SessionID)
	if err != nil {
		return fmt.Errorf("session lookup failed: %w", err)
	}

	// 2. Verify Signature
	if signatureHex != "" {
		pubKey, err := s.sessionRepo.GetProviderPublicKey(ctx, session.ProviderID)
		if err != nil {
			return fmt.Errorf("provider key lookup failed: %w", err)
		}

		if err := s.verifySignature(pubKey, usage.SessionID, usage.BytesUp, usage.BytesDown, nonce, signatureHex); err != nil {
			return fmt.Errorf("invalid signature: %w", err)
		}
	}

	// 3. Aggregate
	totalBytes := usage.BytesUp + usage.BytesDown
	if err := s.billingRepo.IncrementPendingBalance(ctx, session.ID, totalBytes); err != nil {
		return err
	}

	// Fire and forget provider earnings? Or wait?
	// Hexagonal strictness suggests waiting or returning error
	if err := s.billingRepo.IncrementProviderEarnings(ctx, session.ProviderID, totalBytes); err != nil {
		// Log warning?
	}

	return nil
}

func (s *BillingServiceImpl) verifySignature(pubKey, sessionID string, up, down int64, nonce uint64, sigHex string) error {
	// Canonical message
	msg := fmt.Sprintf("%s:%d:%d:%d", sessionID, up, down, nonce)

	sigBytes, err := hex.DecodeString(sigHex)
	if err != nil {
		return err
	}

	pkBytes, err := base58.Decode(pubKey)
	if err != nil {
		// Try hex
		pkBytes, err = hex.DecodeString(pubKey)
		if err != nil {
			return err
		}
	}

	if !ed25519.Verify(pkBytes, []byte(msg), sigBytes) {
		return fmt.Errorf("verification failed")
	}

	return nil
}
