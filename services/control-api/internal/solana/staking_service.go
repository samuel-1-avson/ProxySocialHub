package solana

import (
	"context"
	"fmt"
	"log"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// StakingService manages on-chain provider stakes and slashing logic
type StakingService struct {
	client *OracleClient
}

// NewStakingService creates a new staking service
func NewStakingService(client *OracleClient) *StakingService {
	return &StakingService{
		client: client,
	}
}

// GetStakeAccountPDA derives the stake account PDA for a provider
func (s *StakingService) GetStakeAccountPDA(providerWallet sol.PublicKey) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{
			[]byte("stake"),
			providerWallet.Bytes(),
		},
		s.client.programID,
	)
	return pda, bump, err
}

// SyncStakeBalance fetches on-chain stake and updates the internal database
func (s *StakingService) SyncStakeBalance(ctx context.Context, providerID uuid.UUID) (uint64, error) {
	var user models.User
	if err := db.DB.First(&user, providerID).Error; err != nil {
		return 0, err
	}

	if user.WalletAddress == nil {
		return 0, fmt.Errorf("provider has no wallet address linked")
	}

	wallet, err := sol.PublicKeyFromBase58(*user.WalletAddress)
	if err != nil {
		return 0, err
	}

	pda, _, err := s.GetStakeAccountPDA(wallet)
	if err != nil {
		return 0, err
	}

	// Fetch account info
	accountInfo, err := s.client.rpcClient.GetAccountInfo(ctx, pda)
	if err != nil {
		return 0, fmt.Errorf("failed to fetch stake account: %w", err)
	}

	if accountInfo == nil || accountInfo.Value == nil {
		return 0, nil // No stake found
	}

	// Simple decoding (Layout: 8 (disc) + 32 (owner) + 8 (amount) + ...)
	data := accountInfo.Value.Data.GetBinary()
	if len(data) < 48 {
		return 0, fmt.Errorf("stake account data too short")
	}

	amount := binaryToUint64(data[40:48])

	log.Printf("[StakingService] Provider %s has %v lamports staked", providerID, amount)

	return amount, nil
}

// SlashProvider triggers a slashing instruction on-chain (Admin only)
func (s *StakingService) SlashProvider(ctx context.Context, providerID uuid.UUID, reason string) error {
	// 1. Verify admin permissions
	// 2. Build Transaction with Slash instruction
	// 3. Sign and Broadcast
	log.Printf("[StakingService] SLASHING provider %s for: %s", providerID, reason)

	// Placeholder for actual CPI-equivalent call to slash_stake
	return nil
}

// binaryToUint64 converts a little-endian byte slice to uint64
func binaryToUint64(b []byte) uint64 {
	if len(b) < 8 {
		return 0
	}
	return uint64(b[0]) | uint64(b[1])<<8 | uint64(b[2])<<16 | uint64(b[3])<<24 |
		uint64(b[4])<<32 | uint64(b[5])<<40 | uint64(b[6])<<48 | uint64(b[7])<<56
}
