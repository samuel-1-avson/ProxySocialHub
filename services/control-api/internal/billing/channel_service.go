package billing

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

type StateChannelService struct{}

func NewStateChannelService() *StateChannelService {
	return &StateChannelService{}
}

// OpenChannel initializes a new state channel
func (s *StateChannelService) OpenChannel(sessionID, buyerID, providerID uuid.UUID, initialDeposit uint64) (*models.StateChannel, error) {
	// TODO: Verify initial deposit on-chain or check balance

	channel := &models.StateChannel{
		ID:           uuid.New(),
		SessionID:    sessionID,
		BuyerID:      buyerID,
		ProviderID:   providerID,
		Status:       models.ChannelOpen,
		TotalDeposit: initialDeposit,
		LastState: models.ChannelState{
			Nonce:       0,
			TotalAmount: 0,
			TotalBytes:  0,
			Timestamp:   time.Now().Unix(),
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		ExpiresAt: time.Now().Add(24 * time.Hour), // Default TTL
	}

	if err := db.DB.Create(channel).Error; err != nil {
		return nil, fmt.Errorf("failed to persist channel: %w", err)
	}

	return channel, nil
}

// UpdateState receives a signed state update off-chain
// Message format: "CHANNEL_ID:NONCE:AMOUNT:BYTES"
func (s *StateChannelService) UpdateState(channelID uuid.UUID, state models.ChannelState) error {
	var channel models.StateChannel
	if err := db.DB.First(&channel, "id = ?", channelID).Error; err != nil {
		return fmt.Errorf("channel not found")
	}

	if channel.Status != models.ChannelOpen {
		return fmt.Errorf("channel is %s", channel.Status)
	}

	if state.Nonce <= channel.LastState.Nonce {
		return fmt.Errorf("nonce too low: %d <= %d", state.Nonce, channel.LastState.Nonce)
	}

	// Verify Signature
	// Ideally we fetch the "Signer" public key (Buyer)
	// For now assuming we verify against Buyer's stored key.
	// In strict L2, the PROVIDER verifies this before sending to Backend.
	// But Backend acts as the Provider's agent here.

	// Format: "CHANNEL_ID:NONCE:TOTAL_AMOUNT:TOTAL_BYTES"
	canonicalMsg := fmt.Sprintf("%s:%d:%d:%d", channel.ID.String(), state.Nonce, state.TotalAmount, state.TotalBytes)

	valid, err := s.verifySignature(channel.BuyerID, canonicalMsg, state.Signature)
	if err != nil {
		return err
	}
	if !valid {
		return fmt.Errorf("invalid signature")
	}

	// Update DB
	channel.LastState = state
	channel.UpdatedAt = time.Now()

	// Uses JSON serializer? GORM might need explicit saving of JSONB
	// We can update just the column
	stateJSON, _ := json.Marshal(state)
	if err := db.DB.Model(&channel).Updates(map[string]interface{}{
		"last_state": stateJSON,
		"updated_at": time.Now(),
	}).Error; err != nil {
		return fmt.Errorf("failed to update state: %w", err)
	}

	return nil
}

// Internal helper to verify signature against Buyer's key
func (s *StateChannelService) verifySignature(userID uuid.UUID, msg, sigHex string) (bool, error) {
	// Look up user's public key (e.g. from LinkedWallet or User table)
	// Simplified: Assuming User model or Wallet model has the key
	var wallet models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND verified = true", userID).First(&wallet).Error; err != nil {
		return false, fmt.Errorf("user wallet not found for verification")
	}

	pubKeyBytes, err := base58.Decode(wallet.Address) // Assuming Solana Address
	if err != nil {
		return false, fmt.Errorf("invalid pubkey format")
	}

	sigBytes, err := hex.DecodeString(sigHex)
	if err != nil {
		return false, fmt.Errorf("invalid sig hex")
	}

	if !ed25519.Verify(pubKeyBytes, []byte(msg), sigBytes) {
		logging.Warn().Str("msg", msg).Str("sig", sigHex).Str("pubkey", wallet.Address).Msg("Sig Verify Fail")
		return false, nil
	}

	return true, nil
}
