package treasury

import (
	"context"
	"fmt"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/solana"
)

const (
	// Thresholds
	MinSOLLamports    uint64 = 5 * 1_000_000_000  // 5 SOL
	TargetSOLLamports uint64 = 10 * 1_000_000_000 // 10 SOL

	// Tokens
	WSOLMint = "So11111111111111111111111111111111111111112"
	TAOMint  = "tao..." // Deduced from config or DB
)

type LiquidityManager struct {
	client *solana.OracleClient
	dex    DEXAggregator
}

type DEXAggregator interface {
	GetQuote(inputMint, outputMint string, amount uint64) (uint64, error)
	Swap(inputMint, outputMint string, amount uint64) (string, error) // Returns tx signature
}

func NewLiquidityManager(client *solana.OracleClient, dex DEXAggregator) *LiquidityManager {
	return &LiquidityManager{
		client: client,
		dex:    dex,
	}
}

// StartRebalanceLoop runs periodically to check balances
func (lm *LiquidityManager) StartRebalanceLoop(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := lm.CheckAndRebalance(ctx); err != nil {
					// Log error but continue loop
					fmt.Printf("Liquidity Rebalance Failed: %v\n", err)
				}
			}
		}
	}()
}

// CheckAndRebalance checks Treasury balances and swaps if needed
func (lm *LiquidityManager) CheckAndRebalance(ctx context.Context) error {
	// 1. Get Oracle/Treasury Balance (Operational Wallet)
	lamports, err := lm.client.GetBalance(ctx)
	if err != nil {
		return fmt.Errorf("failed to get balance: %w", err)
	}

	balanceSOL := solana.LamportsToSOL(lamports)
	logging.Info().Float64("SOL", balanceSOL).Msg("Checking Liquidity")

	// 2. Logic: If Balance < Min, Swap TAO -> SOL
	if lamports < MinSOLLamports {
		logging.Warn().Float64("current", balanceSOL).Msg("Low SOL Liquidity. Initiating Swap.")

		neededLamports := TargetSOLLamports - lamports
		_ = neededLamports // Use in real implementation

		// In a real impl, we'd calculate exact amount based on Oracle price
		// Assuming we swap 50 TAO for SOL
		swapAmountAtomic := uint64(50 * 1e9) // 50 TAO

		sig, err := lm.dex.Swap(TAOMint, WSOLMint, swapAmountAtomic)
		if err != nil {
			return fmt.Errorf("swap failed: %w", err)
		}

		logging.Info().Str("tx", sig).Msg("Rebalance Swap Successful")
	}

	return nil
}

// MockJupiterClient implements DEXAggregator for now
type MockJupiterClient struct{}

func (m *MockJupiterClient) GetQuote(in, out string, amt uint64) (uint64, error) {
	return amt * 100, nil // Mock rate
}

func (m *MockJupiterClient) Swap(in, out string, amt uint64) (string, error) {
	logging.Info().Msgf("MOCK SWAP: %d %s -> %s", amt, in, out)
	return "mock_tx_signature_jupiter", nil
}
