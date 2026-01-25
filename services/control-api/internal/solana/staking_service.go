package solana

import (
	"context"
	"fmt"
	"log"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
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
	var accountInfo *rpc.GetAccountInfoResult
	err = s.client.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		accountInfo, err = client.GetAccountInfo(ctx, pda)
		return err
	})
	if err != nil {
		return 0, fmt.Errorf("failed to fetch stake account: %w", err)
	}

	if accountInfo == nil || accountInfo.Value == nil {
		return 0, nil // No stake found
	}

	// Anchor account discriminator for StakeAccount (8 bytes)
	data := accountInfo.Value.Data.GetBinary()
	if len(data) < 74 { // 8 + 32 + 8 + 8 + 8 + 1 + 1 (bump)
		return 0, fmt.Errorf("stake account data too short")
	}

	amount := binaryToUint64(data[40:48])

	log.Printf("[StakingService] Provider %s has %v lamports staked", providerID, amount)

	return amount, nil
}

// SlashProvider triggers a slashing instruction on-chain (Admin only)
func (s *StakingService) SlashProvider(ctx context.Context, providerID uuid.UUID, amount uint64, reason string) error {
	var user models.User
	if err := db.DB.First(&user, providerID).Error; err != nil {
		return err
	}

	if user.WalletAddress == nil {
		return fmt.Errorf("provider has no wallet address linked")
	}

	wallet, err := sol.PublicKeyFromBase58(*user.WalletAddress)
	if err != nil {
		return err
	}

	log.Printf("[StakingService] SLASHING provider %s for %v lamports. Reason: %s", providerID, amount, reason)

	txSig, err := s.client.SlashStake(ctx, SlashStakeParams{
		ProviderWallet: wallet,
		Amount:         amount,
	})
	if err != nil {
		return fmt.Errorf("failed to execute slashing: %w", err)
	}

	log.Printf("[StakingService] Slash successful: %s", txSig)
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

var globalStakingService *StakingService

func InitStakingService(client *OracleClient) {
	globalStakingService = NewStakingService(client)
}

func GetStakingService() *StakingService {
	return globalStakingService
}
