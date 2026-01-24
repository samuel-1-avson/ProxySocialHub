package bridge

import (
	"context"
	"fmt"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/solana"
)

type SolanaAdapter struct {
	client *solana.OracleClient
	vault  sol.PublicKey
}

func NewSolanaAdapter(client *solana.OracleClient) (*SolanaAdapter, error) {
	vaultStr := solana.GetTreasuryAddress()
	if vaultStr == "" {
		// Fallback for dev if not set, or error
		return &SolanaAdapter{client: client, vault: client.GetOraclePublicKey()}, nil
	}

	vault, err := sol.PublicKeyFromBase58(vaultStr)
	if err != nil {
		return nil, fmt.Errorf("invalid solana bridge vault address: %w", err)
	}

	return &SolanaAdapter{
		client: client,
		vault:  vault,
	}, nil
}

// VerifyDeposit checks if a transaction sent funds to the bridge vault
func (s *SolanaAdapter) VerifyDeposit(ctx context.Context, txHash string) (uint64, error) {
	amount, err := s.client.VerifyTransaction(ctx, txHash, s.vault)
	if err != nil {
		return 0, err
	}
	return amount, nil
}

// GetVaultAddress returns the deposit address
func (s *SolanaAdapter) GetVaultAddress() string {
	return s.vault.String()
}
