package billing

import (
	"context"
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
	"github.com/proxyhubb/control-api/internal/solana"
)

type StateChannelService struct{}

func NewStateChannelService() *StateChannelService {
	return &StateChannelService{}
}

// OpenChannel initializes a new state channel.
// M-08: Verifies the buyer has sufficient balance before opening —
// checks on-chain SOL balance via the oracle, falling back to the DB wallet.
func (s *StateChannelService) OpenChannel(sessionID, buyerID, providerID uuid.UUID, initialDeposit uint64) (*models.StateChannel, error) {
	const lamportsPerSOL = 1_000_000_000

	// Resolve buyer's linked Solana wallet.
	var linkedWallet models.LinkedWallet
	hasLinked := db.DB.
		Where("user_id = ? AND chain = 'solana' AND verified = true", buyerID).
		First(&linkedWallet).Error == nil

	if hasLinked {
		oracle := solana.GetOracleClient()
		if oracle != nil {
			pubkey, err := solana.PublicKeyFromBase58String(linkedWallet.Address)
			if err == nil {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				balanceLamports, err := oracle.GetBalance(ctx, pubkey)
				if err == nil {
					if balanceLamports < initialDeposit {
						return nil, fmt.Errorf(
							"insufficient on-chain balance: have %d lamports, need %d",
							balanceLamports, initialDeposit,
						)
					}
					// Balance verified on-chain — proceed.
					goto channelCreate
				}
				logging.Warn().Err(err).Msg("OpenChannel: on-chain balance check failed, falling back to DB wallet")
			}
		}
	}

	// DB wallet fallback — convert lamports to SOL for comparison.
	{
		var wallet models.Wallet
		if err := db.DB.Where("user_id = ?", buyerID).First(&wallet).Error; err != nil {
			return nil, fmt.Errorf("buyer wallet not found")
		}
		requiredSOL := float64(initialDeposit) / lamportsPerSOL
		if wallet.BalanceSOL < requiredSOL {
			return nil, fmt.Errorf(
				"insufficient balance: have %.6f SOL, need %.6f SOL",
				wallet.BalanceSOL, requiredSOL,
			)
		}
	}

channelCreate:
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

	// L2-CHANNEL: Lock deposit on-chain so it is custodied by the Solana program
	// rather than just tracked in the DB.  Non-fatal: if on-chain lock fails we
	// still allow the channel to proceed off-chain (graceful degradation until
	// the Solana program is fully deployed to all networks).
	go func(ch *models.StateChannel) {
		oracle := solana.GetOracleClient()
		if oracle == nil {
			return
		}

		// Resolve buyer and provider on-chain wallets.
		var buyer, provider models.LinkedWallet
		if db.DB.Where("user_id = ? AND chain = 'solana' AND verified = true", ch.BuyerID).First(&buyer).Error != nil {
			return
		}
		if db.DB.Where("user_id = ? AND chain = 'solana' AND verified = true", ch.ProviderID).First(&provider).Error != nil {
			return
		}

		buyerPK, err := solana.PublicKeyFromBase58String(buyer.Address)
		if err != nil {
			return
		}
		providerPK, err := solana.PublicKeyFromBase58String(provider.Address)
		if err != nil {
			return
		}

		var sessionIDBytes [16]byte
		copy(sessionIDBytes[:], ch.SessionID[:])

		onChainCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		txSig, channelPDA, err := oracle.OpenChannelOnChain(onChainCtx, sessionIDBytes, buyerPK, providerPK, ch.TotalDeposit)
		if err != nil {
			logging.Warn().Err(err).Str("channel_id", ch.ID.String()).Msg("OpenChannel: on-chain lock failed (non-fatal)")
			return
		}

		// Persist the on-chain PDA address for settlement.
		db.DB.Model(ch).Updates(map[string]interface{}{
			"onchain_pda":    channelPDA.String(),
			"onchain_tx_sig": txSig,
		})
		logging.Info().Str("channel_id", ch.ID.String()).Str("pda", channelPDA.String()).Str("sig", txSig).Msg("OpenChannel: on-chain lock confirmed")
	}(channel)

	return channel, nil
}

// CloseChannel settles a state channel: the oracle submits the final signed
// state, pays the provider their earned amount, and refunds the buyer.
func (s *StateChannelService) CloseChannel(channelID uuid.UUID, finalState models.ChannelState) error {
	var channel models.StateChannel
	if err := db.DB.First(&channel, "id = ?", channelID).Error; err != nil {
		return fmt.Errorf("channel not found")
	}
	if channel.Status == models.ChannelClosed {
		return fmt.Errorf("channel already closed")
	}

	// Verify the final state signature before closing.
	canonicalMsg := fmt.Sprintf("%s:%d:%d:%d", channel.ID.String(), finalState.Nonce, finalState.TotalAmount, finalState.TotalBytes)
	valid, err := s.verifySignature(channel.BuyerID, canonicalMsg, finalState.Signature)
	if err != nil || !valid {
		return fmt.Errorf("invalid final state signature")
	}

	// Mark closed in DB first (idempotent guard).
	now := time.Now()
	if err := db.DB.Model(&channel).Updates(map[string]interface{}{
		"status":     models.ChannelClosed,
		"last_state": finalState,
		"updated_at": now,
	}).Error; err != nil {
		return fmt.Errorf("failed to close channel in DB: %w", err)
	}

	// Settle on-chain asynchronously.
	go func(ch models.StateChannel, state models.ChannelState) {
		oracle := solana.GetOracleClient()
		if oracle == nil {
			return
		}

		var buyer, provider models.LinkedWallet
		if db.DB.Where("user_id = ? AND chain = 'solana' AND verified = true", ch.BuyerID).First(&buyer).Error != nil {
			return
		}
		if db.DB.Where("user_id = ? AND chain = 'solana' AND verified = true", ch.ProviderID).First(&provider).Error != nil {
			return
		}

		buyerPK, err := solana.PublicKeyFromBase58String(buyer.Address)
		if err != nil {
			return
		}
		providerPK, err := solana.PublicKeyFromBase58String(provider.Address)
		if err != nil {
			return
		}

		var sessionIDBytes [16]byte
		copy(sessionIDBytes[:], ch.SessionID[:])

		onChainCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		txSig, err := oracle.CloseChannelOnChain(onChainCtx, sessionIDBytes, providerPK, buyerPK,
			uint64(state.Nonce), state.TotalAmount)
		if err != nil {
			logging.Warn().Err(err).Str("channel_id", ch.ID.String()).Msg("CloseChannel: on-chain settlement failed")
			return
		}
		logging.Info().Str("channel_id", ch.ID.String()).Str("sig", txSig).Msg("CloseChannel: on-chain settlement confirmed")
	}(channel, finalState)

	return nil
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
